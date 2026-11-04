import assert from 'node:assert/strict';
import test from 'node:test';
import { chatRequest, createOpenClient, OPEN_MODEL, OPEN_PRICE, responseFromChat } from '../src/agent/open-client.mjs';
import { readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { AUTO_PORT_TOOL, autoPortRequest, readSubmission } from '../src/auto-port/request.mjs';

const request = autoPortRequest({ file: 'core.js', source: 'player.x += vx;' });

test('a port request becomes one forced strict tool call on the open model', () => {
  const chat = chatRequest(request);
  assert.equal(chat.model, OPEN_MODEL);
  assert.equal(chat.messages[0].role, 'system');
  assert.equal(chat.messages[0].content, request.instructions);
  assert.match(chat.messages[1].content, /player\.x \+= vx/);
  assert.equal(chat.max_tokens, request.max_output_tokens);
  assert.equal(chat.reasoning_effort, 'low');
  assert.equal(chat.tools[0].function.name, AUTO_PORT_TOOL.name);
  assert.equal(chat.tools[0].function.strict, true);
  assert.deepEqual(chat.tool_choice, { type: 'function', function: { name: AUTO_PORT_TOOL.name } });
  assert.equal(chat.parallel_tool_calls, false);
});

test('a chat reply reads like a Meta response, so the frozen readers and accounting still work', () => {
  const args = JSON.stringify({ status: 'supported', summary: 'ok', unitsPerSourcePixel: 1, patches: [] });
  const response = responseFromChat({
    choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: AUTO_PORT_TOOL.name, arguments: args } }] } }],
    usage: { prompt_tokens: 1000, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 50 } },
  });
  assert.equal(response.status, 'completed');
  assert.equal(readSubmission(response).status, 'supported');
  const usage = readUsage(response.usage);
  assert.equal(usage.reasoningTokens, 50);
  assert.ok(Math.abs(tokenCost(usage, OPEN_PRICE) - 0.0021) < 1e-9);
});

test('a reply cut off at the token limit is reported as incomplete', () => {
  assert.equal(responseFromChat({ choices: [{ finish_reason: 'length', message: {} }], usage: {} }).status, 'incomplete');
});

test('the client sends the key, and reports a failure without retrying', async () => {
  let calls = 0, headers;
  const client = createOpenClient('test-key', { fetchImpl: async (_url, options) => {
    calls += 1; headers = options.headers;
    return new Response('rate limited', { status: 429 });
  } });
  await assert.rejects(() => client.respond(request), /HTTP 429/);
  assert.equal(calls, 1);
  assert.equal(headers.Authorization, 'Bearer test-key');
  assert.throws(() => createOpenClient(''), /BASETEN_API_KEY/);
});
