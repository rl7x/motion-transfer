import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { investigate, DEFAULT_LIMITS } from '../agent/investigate.mjs';
import { createMetaClient } from '../agent/meta-client.mjs';

const trace = JSON.parse(await readFile(new URL('../experiments/dashy-dango/start-move-dash.json', import.meta.url), 'utf8'));
const usage = { input_tokens: 900, output_tokens: 100, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 80 } };
const call = (id, name, args) => ({ type: 'function_call', call_id: id, status: 'completed', name, arguments: JSON.stringify(args) });
const response = (id, output) => ({ id, status: 'completed', model: 'muse-wonder-1.0', output, usage });

test('Meta loop dispatches real cartridge tools, preserves private state, and cites experiments', async () => {
  const changed = structuredClone(trace.steps);
  changed.find(step => step.checkpoint === 'move-right').buttons = 16;
  const replies = [
    response('r1', [
      { type: 'reasoning', id: 'rs-one', encrypted_content: 'opaque-test-state' },
      { type: 'message', phase: 'commentary', role: 'assistant', content: [{ type: 'output_text', text: 'I will inspect the binary.' }] },
      call('c1', 'inspect_wasm', { view: 'overview', startLine: 1, lineCount: 20 }),
    ]),
    response('r2', [call('c2', 'run_original', { hypothesis: 'Right movement produces a baseline.', steps: trace.steps })]),
    response('r3', [call('c3', 'run_original', { hypothesis: 'Left movement changes the same checkpoint.', steps: changed })]),
    response('r4', [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The rendered movement differs between exp-001 and exp-002. This does not establish dash timing.' }] }]),
  ];
  const requests = [];
  const client = createMetaClient('fake-secret-key', { fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) {
      const compacted = body.input.some(item => item.role === 'user' && item.content?.some(block => block.text?.includes('ledger contains actual')));
      return new Response(JSON.stringify({ input_tokens: requests.length === 3 && !compacted ? 25_000 : 1_000 }));
    }
    requests.push(body);
    return new Response(JSON.stringify(replies.shift()));
  } });
  const report = await investigate({ client, question: 'Compare right and left movement.' });
  assert.equal(report.status, 'completed');
  assert.equal(report.conclusionVerified, false);
  assert.equal(requests.length, 4);
  assert.equal(report.requests.length, 4);
  assert.equal(report.toolCalls.filter(tool => tool.experimentId).length, 2);
  assert.equal(report.usage.inputTokens, 3_600);
  assert.equal(report.usage.outputTokens, 400);
  assert.equal(report.usage.reasoningTokens, 320);
  assert.equal(report.reservedCostUsd, 0);
  assert.ok(Math.abs(report.estimatedCostUsd - 0.02088) < 1e-9);
  assert.deepEqual(requests[1].input.find(item => item.type === 'reasoning'), {
    type: 'reasoning', id: 'rs-one', summary: [], encrypted_content: 'opaque-test-state',
  });
  assert.equal(requests[1].input.find(item => item.type === 'message').phase, 'commentary');
  assert.ok(requests[1].input.some(item => item.type === 'function_call_output' && item.call_id === 'c1'));
  assert.equal(requests[1].store, false);
  assert.ok(report.contextCompactions.some(item => item.reason === 'input-token-limit'));
  assert.ok(requests[3].input.some(item => item.content?.some(block => block.text?.includes('exp-001'))));
  assert.ok(!requests[3].input.some(item => item.type === 'reasoning'));
  assert.doesNotMatch(JSON.stringify(report), /opaque-test-state|fake-secret-key/);
});

test('cost preflight rejects a request before inference can spend beyond the budget', async () => {
  let calls = 0;
  const client = { countInputTokens: async () => 10_000, respond: async () => { calls++; } };
  await assert.rejects(investigate({ client, limits: { maxCostUsd: 0.01 } }), error => {
    assert.match(error.message, /Cost budget/);
    assert.equal(error.report.requests.length, 0);
    assert.equal(error.report.reservedCostUsd, 0);
    return true;
  });
  assert.equal(calls, 0);
});

test('uncertain requests retain their reservation and are not retried', async () => {
  let calls = 0;
  const client = { countInputTokens: async () => 1_000, respond: async () => { calls++; throw new Error('uncertain transport'); } };
  await assert.rejects(investigate({ client }), error => {
    assert.equal(error.report.status, 'failed');
    assert.ok(error.report.reservedCostUsd > 0);
    assert.equal(error.report.requests[0].status, 'unsettled');
    return true;
  });
  assert.equal(calls, 1);
});

function settledEvidence() {
  const checkpoint = { checkpoint: 'observed', frame: 1, framebufferHash: 'a'.repeat(64), palette: [], text: '', sprites: [], tones: [] };
  return {
    schemaVersion: 1, status: 'failed', question: 'Compare controls.', model: 'muse-wonder-1.0',
    limits: { ...DEFAULT_LIMITS },
    target: { sha256: '152d44c6e9ef48a254125cd5ebe266998a9bc74ea104692f5d2280fca6e9b42f' },
    usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0, reasoningTokens: 0 },
    estimatedCostUsd: 0.15, reservedCostUsd: 0,
    requests: Array.from({ length: 5 }, (_, index) => ({ attempt: index + 1, status: 'completed', usage: { inputTokens: 20, outputTokens: 20 } })),
    turns: [], conclusion: null, conclusionVerified: false,
    toolCalls: [
      { name: 'inspect_wasm', callId: 'original-inspect', ok: true, result: { exports: ['update'] } },
      ...[1, 2].map(number => ({
        name: 'run_original', callId: `original-${number}`, ok: true, experimentId: `exp-00${number}`,
        args: { hypothesis: 'Test hypothesis', steps: [{ buttons: number, frames: 1, checkpoint: 'observed' }] },
        result: { checkpoints: [checkpoint] },
      })),
    ],
  };
}

test('resuming settled evidence uses only the remaining call and carries forward spend', async () => {
  let calls = 0;
  const report = await investigate({
    question: 'Compare controls.', resumeReport: settledEvidence(),
    client: {
      countInputTokens: async () => 1_000,
      respond: async request => {
        calls++;
        assert.deepEqual(request.tools, []);
        assert.ok(request.input.some(item => item.content?.some(block => block.text?.includes('exp-002'))));
        return response('r6', [{ type: 'message', content: [{ type: 'output_text', text: 'exp-001 and exp-002 are contrasting observations. Further interpretation is uncertain.' }] }]);
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.requests.length, 6);
  assert.equal(report.status, 'completed');
  assert.ok(report.estimatedCostUsd > 0.15);
  assert.ok(report.estimatedCostUsd < 0.50);
});

test('resume cannot reset the budget or retry an unsettled request', async () => {
  const client = { countInputTokens: async () => 1_000, respond: async () => assert.fail('Must not generate') };
  const exhausted = settledEvidence();
  exhausted.estimatedCostUsd = 0.49;
  await assert.rejects(investigate({ client, question: exhausted.question, resumeReport: exhausted }), /Cost budget/);
  const unsettled = settledEvidence();
  unsettled.reservedCostUsd = 0.1;
  await assert.rejects(investigate({ client, question: unsettled.question, resumeReport: unsettled }), /unsettled usage/);
  await assert.rejects(investigate({ client, question: exhausted.question, resumeReport: exhausted, limits: { maxCostUsd: 0.90 } }), /original limits/);
});

test('an unsupported final claim and missing usage cannot be marked completed', async () => {
  const final = response('r1', [{ type: 'message', content: [{ type: 'output_text', text: 'I know the answer without experiments.' }] }]);
  const client = { countInputTokens: async () => 10, respond: async () => final };
  await assert.rejects(investigate({ client }), /two contrasting, cited experiments/);
  const noUsage = { ...client, respond: async () => ({ ...final, usage: undefined }) };
  await assert.rejects(investigate({ client: noUsage }), error => {
    assert.match(error.message, /usage accounting/);
    assert.ok(error.report.reservedCostUsd > 0);
    return true;
  });
});

test('model call limits stop a loop that keeps requesting tools', async () => {
  let calls = 0;
  const client = {
    countInputTokens: async () => 10,
    respond: async () => { calls++; return response('r1', [call('c1', 'inspect_wasm', { view: 'overview', startLine: 1, lineCount: 5 })]); },
  };
  await assert.rejects(investigate({ client, limits: { maxModelCalls: 1 } }), /Model call limit/);
  assert.equal(calls, 1);
});
