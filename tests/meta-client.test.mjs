import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaClient } from '../src/agent/meta-client.mjs';

test('token preflight counts the same model, instructions, history, and tools', async () => {
  const calls = [];
  const client = createMetaClient('fake-key', { fetchImpl: async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ input_tokens: 123 }));
  } });
  const request = { model: 'muse-wonder-1.0', instructions: 'Instructions', input: [], tools: [], store: false };
  assert.equal(await client.countInputTokens(request), 123);
  assert.equal(calls[0].url, 'https://api.meta.ai/v1/responses/input_tokens');
  assert.equal(calls[0].redirect, 'error');
  assert.deepEqual(calls[0].body, { model: request.model, instructions: request.instructions, input: [], tools: [] });
});

test('HTTP failures do not echo provider bodies or retry', async () => {
  let requests = 0;
  const client = createMetaClient('fake-private-key', { fetchImpl: async () => {
    requests++;
    return new Response('fake-private-key', { status: 401 });
  } });
  await assert.rejects(client.respond({}), error => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /fake-private-key/);
    return true;
  });
  assert.equal(requests, 1);
});

test('transport failure is not retried and reports uncertain billing', async () => {
  let requests = 0;
  const client = createMetaClient('fake-key', { fetchImpl: async () => { requests++; throw new Error('network'); } });
  await assert.rejects(client.respond({}), /billing may be uncertain/);
  assert.equal(requests, 1);
});

test('request timeout aborts the HTTP operation', async () => {
  const client = createMetaClient('fake-key', {
    requestTimeoutMs: 10,
    fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('{}')), 5_000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    }),
  });
  await assert.rejects(client.respond({}), /timed out or was cancelled/);
});

test('oversized responses and missing token counts fail closed', async () => {
  const huge = createMetaClient('fake-key', { fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(huge.respond({}), /exceeded 2 MB/);
  const invalid = createMetaClient('fake-key', { fetchImpl: async () => new Response('{}') });
  await assert.rejects(invalid.countInputTokens({}), /token count is missing/);
});
