import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => JSON.parse(JSON.stringify(value, (key, item) => ['at', 'startedAt', 'finishedAt'].includes(key) ? undefined : item));
const usage = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 20 } };
const tool = (id, name, args, namespace) => ({ type: 'function_call', call_id: id, status: 'completed', name, arguments: JSON.stringify(args), ...(namespace ? { namespace } : {}) });

// Stable provider/tool fixtures measure the public orchestration contract. No API
// client or cartridge worker is created; actual execution has separate tests.
async function captureScenario(investigate, scenario) {
  const requests = [], events = [], updates = [], dispatches = [];
  let turn = 0;
  const client = {
    async countInputTokens(request) {
      events.push({ kind: 'preflight', requestSha256: sha(request) });
      const compacted = request.input.some(item => item.content?.some(block => block.text?.includes('ledger contains actual')));
      return scenario === 'native' && turn === 2 && !compacted ? 25000 : 1000;
    },
    async respond(request) {
      requests.push(sha(request)); turn++;
      events.push({ kind: 'generation', turn });
      if (scenario === 'transport') throw Error('Injected uncertain transport');
      if (scenario === 'missing-usage') return { id: 'fixture-missing-usage', status: 'completed', output: [] };
      let output;
      if (turn === 1) output = [
        { type: 'reasoning', id: 'fixture-reasoning', encrypted_content: 'private-fixture-continuation' },
        { type: 'tool_search_call', id: 'fixture-search', call_id: 'fixture-search-call', status: 'completed', execution: 'client', arguments: { namespace: 'execution' } },
      ];
      if (turn === 2 || turn === 3) output = [tool('fixture-move-' + turn, 'run_original', {
        hypothesis: 'Injected contract fixture, not a model discovery.', watches: [], steps: [{ buttons: turn === 2 ? 32 : 16, frames: 4, checkpoint: 'move' }],
      }, 'execution')];
      if (turn === 4) output = [tool('fixture-overview', 'inspect_wasm', { view: 'overview', startLine: 1, lineCount: 5 })];
      if (turn === 5) output = [{ type: 'message', content: [{ type: 'output_text', text: 'exp-001 and exp-002 differ under the chosen inputs; this finite fixture does not establish every movement rule.' }] }];
      return { id: 'fixture-response-' + turn, status: 'completed', model: 'muse-spark-1.3', usage, output };
    },
  };
  const options = {
    client, model: 'muse-spark-1.3', toolDiscovery: 'client', limits: { maxModelCalls: 5 },
    question: 'Offline contract comparison before and after a refactor.',
    onProgress: message => events.push({ kind: 'progress', message }),
    onUpdate: async report => updates.push(normalize(report)),
    runTool: async (name, args) => {
      dispatches.push({ name, args });
      if (name === 'inspect_wasm') return { result: { imports: [], exports: [{ name: 'update', kind: 'function' }] } };
      const x = args.steps[0].buttons === 32 ? 8 : -8;
      return { result: { checkpoints: [{ checkpoint: 'move', frame: 4, framebufferHash: (x > 0 ? 'a' : 'b').repeat(64), text: '', sprites: [], tones: [], palette: [], memory: [], motion: { position: { x, y: 0 } } }] } };
    },
  };
  let report, error;
  try { report = await investigate(options); }
  catch (failure) { error = failure.message; report = failure.report; }
  return { requests, events, dispatches, updateHashes: updates.map(sha), report: normalize(report), ...(error ? { error } : {}) };
}

export async function captureInvestigationContract(investigate) {
  return Object.fromEntries(await Promise.all(['native', 'transport', 'missing-usage'].map(async scenario => [scenario, await captureScenario(investigate, scenario)])));
}
