import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRICES } from '../agent/accounting.mjs';
import { createComponentWorkbench } from '../agent/component-workbench.mjs';
import { createRecoveryProtocol } from '../agent/recovery-protocol.mjs';
import { loadTarget } from '../agent/target.mjs';
import { compileMotion } from '../component/build.mjs';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { createInvestigationSession } from '../runtime/investigation-session.mjs';
import {
  PINNED_MUSE_VERSION, admitNextRequest, appendJsonLine, createTurnAuthority, defaultMuseBinary, emptySpend,
  eventToolViolations, isPinnedMuseVersion, museChildEnv, museExecArgs, museSettingsDocument, museSpendControl,
  prepareMusePaidRun, recordUsage, trustedTurnBefore,
} from '../mcp/control.mjs';
import { cleanRoomTask, createMotionHost } from '../mcp/host.mjs';

const source = `export function init(){return {cooldown:0,remaining:0};}
export function step(state){return {state,output:{ownsMotion:false,displacement:{x:0,y:0},events:[]}};}`;
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const serverPath = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));

function generation(kind, turn) {
  return { payload_type: 'task.lifecycle.proposed', payload: { event: { task_kind: kind, turn }, turn } };
}

test('trusted turns count host-observed generations and ignore embedded integers', () => {
  const reminder = { payload_type: 'task.lifecycle.proposed', payload: { event: { task_kind: 'reminder.agent.skill-reminder', turn: 7 } } };
  const events = [reminder, generation('model.unknown.response', 99), { payload_type: 'tool', payload: { name: 'inspect_wasm', turn: 99 } }, generation('model.meta.response', 4)];
  assert.throws(() => trustedTurnBefore(events, 0), /preceding trusted model generation/);
  assert.throws(() => trustedTurnBefore(events, 1), /preceding trusted model generation/);
  assert.equal(trustedTurnBefore(events, 2), 0);
  assert.equal(trustedTurnBefore(events, 4), 1);
  const authority = createTurnAuthority();
  authority.grant(1);
  assert.throws(() => authority.grant(0), /backwards/);
  authority.grant(1);
  assert.equal(authority.current(), 1);
});

test('a model-supplied turn cannot open the journal or reach dispatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-turn-'));
  const authority = createTurnAuthority();
  let dispatched = 0;
  const host = await createMotionHost({
    directory, protocol: createRecoveryProtocol(), authority,
    target: { id: 'target-001', sha256: 'ab'.repeat(32), byteLength: 4 },
    dispatch: async () => { dispatched++; return { result: {} }; },
  });
  await assert.rejects(host.call('inspect_wasm', { turn: 5, requestAttempt: 9 }), /trusted model turn/);
  assert.equal(dispatched, 0);
  await rm(directory, { recursive: true, force: true });
});

test('same-turn evidence is rejected before dispatch and the ignored turn is not the request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-same-turn-'));
  const protocol = createRecoveryProtocol();
  const authority = createTurnAuthority();
  let dispatched = 0;
  const host = await createMotionHost({
    directory, protocol, authority,
    target: { id: 'target-001', sha256: 'ab'.repeat(32), byteLength: 4 },
    dispatch: async () => { dispatched++; return { result: {} }; },
  });
  const selectionId = 'selection-1';
  const experimentId = 'obs-0001';
  host.report.session = {
    branches: [], checkpoints: [],
    recovery: {
      protocol, selections: [{ id: selectionId, evidence: { functions: [{ id: 'binary:func9', functionIndex: 9 }], traces: [{ id: experimentId }] } }], attempts: [],
    },
    staticEvidence: [{ id: 'binary:func9', functionIndex: 9, kind: 'wat' }],
  };
  host.report.toolCalls.push(
    { callId: 'experiment', name: 'run_experiment', ok: true, requestAttempt: 1, result: { status: 'completed', experimentId, artifactRef: { id: 'a'.repeat(64) }, initialEditDifference: { edits: [{ value: 1 }] }, frameCount: 8 } },
    { callId: 'selection', name: 'select_component_evidence', ok: true, requestAttempt: 1, result: { selectionId } },
  );
  authority.grant(2);
  const outcome = await host.call('submit_component_candidate', {
    turn: 99, selectionId, source, timerFields: { cooldown: 'cooldown', remaining: 'remaining' },
    contract: { name: 'same turn', scope: 'Fixture.', defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 }, stateDescription: 'Counters.', rules: [{ description: 'Cite both.', evidence: ['binary:func9', experimentId] }], limitations: ['No recovery is claimed.'] },
  });
  assert.match(outcome.entry.error, /later model turn/);
  assert.equal(outcome.entry.ok, false);
  assert.equal(outcome.entry.requestAttempt, 3);
  assert.equal(outcome.entry.untrustedTurnIgnored, 99);
  assert.equal(dispatched, 0);
  const saved = await readFile(join(directory, 'report.json'), 'utf8');
  assert.equal(JSON.parse(saved).toolCalls.at(-1).requestAttempt, 3);
  await rm(directory, { recursive: true, force: true });
});

test('MCP image content keeps a small PNG and withholds an oversized one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-image-'));
  const authority = createTurnAuthority();
  const large = Buffer.alloc(70_000, 7).toString('base64');
  const host = await createMotionHost({
    directory, protocol: createRecoveryProtocol(), authority,
    target: { id: 'target-001', sha256: 'ab'.repeat(32), byteLength: 4 },
    dispatch: async () => ({ result: { view: 'overview' }, images: [
      { dataUrl: `data:image/png;base64,${tinyPng}`, evidenceId: 'frame-1', sessionId: 's', branchId: 'main', frame: 1, pngSha256: 'b'.repeat(64) },
      { dataUrl: `data:image/png;base64,${large}`, evidenceId: 'frame-2', sessionId: 's', branchId: 'main', frame: 2, pngSha256: 'c'.repeat(64) },
    ] }),
  });
  authority.grant(0);
  const outcome = await host.call('inspect_wasm', { turn: 4 });
  assert.equal(outcome.mcp.isError, false);
  assert.equal(outcome.mcp.content.filter(item => item.type === 'image').length, 1);
  assert.equal(outcome.mcp.content.find(item => item.type === 'image').data, tinyPng);
  assert.match(outcome.mcp.content.at(-1).text, /withheld/);
  const text = outcome.mcp.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  assert.equal(text.includes(large.slice(0, 80)), false);
  const saved = await readFile(join(directory, 'report.json'), 'utf8');
  assert.equal(saved.includes(large.slice(0, 80)), false);
  assert.equal(saved.includes('data:image/png'), false);
  await rm(directory, { recursive: true, force: true });
});

test('dollar and token ceilings stop a later request when the step cap would not', () => {
  const control = museSpendControl();
  assert.equal(control.enforceable, false);
  assert.equal(control.stepCapIsSpendBound, false);
  const open = admitNextRequest({ limits: { maxInputTokens: 10, maxOutputTokens: 10, maxModelCalls: 150, maxCostUsd: 1 }, price: PRICES['muse-spark-1.3-contributor'], spent: emptySpend(), control });
  assert.equal(open.ok, false);
  const enforced = { enforceable: true, turnOrdering: true };
  const price = PRICES['muse-spark-1.3-contributor'];
  const limits = { maxInputTokens: 1_000_000, maxOutputTokens: 1_000_000, maxModelCalls: 4, maxCostUsd: 0.30 };
  const first = admitNextRequest({ limits, price, spent: emptySpend(), control: enforced });
  assert.equal(first.ok, true);
  const recorded = recordUsage(emptySpend(), { inputTokens: limits.maxInputTokens, outputTokens: limits.maxOutputTokens }, price, limits);
  assert.equal(recorded.overrun, false);
  const second = admitNextRequest({ limits, price, spent: recorded.spent, control: enforced });
  assert.equal(second.ok, false);
  assert.match(second.reason, /Hard dollar bound/);
  const over = recordUsage(emptySpend(), { inputTokens: 1, outputTokens: limits.maxOutputTokens + 1 }, price, limits);
  assert.equal(over.overrun, true);
});

test('paid preparation reserves only an injected enforceable control', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-phase-'));
  const protocol = createRecoveryProtocol();
  const closed = await createPhaseBudget(directory);
  await assert.rejects(prepareMusePaidRun({ phaseBudget: closed, protocol }), /Paid Muse run refused/);
  assert.equal((await closed.status()).reservations, 0);
  const opened = await createPhaseBudget(directory);
  const reservation = await prepareMusePaidRun({ phaseBudget: opened, protocol, control: { enforceable: true, turnOrdering: true } });
  assert.equal(reservation.category, 'recovery');
  assert.equal(reservation.maxCostUsd, 0.50);
  assert.equal((await opened.status()).reservations, 1);
  await rm(directory, { recursive: true, force: true });
});

test('echo argv, settings, and the child environment stay isolated', () => {
  const echo = museExecArgs({ provider: 'echo', workspace: '/tmp/room', promptFile: '/tmp/room/TASK.md', maxModelSteps: 1 });
  assert.ok(echo.includes('--disable-shell') && echo.includes('--disable-web-tools') && echo.includes('--no-foreign-personal-context') && echo.includes('--disable-approval'));
  assert.equal(echo.includes('--api-key-stdin'), false);
  assert.equal(echo.includes('--reasoning-effort'), false);
  const meta = museExecArgs({ provider: 'meta', workspace: '/tmp/room', promptFile: '/tmp/room/TASK.md', maxModelSteps: 1 });
  assert.ok(meta.includes('--api-key-stdin') && meta.includes('--reasoning-effort') && meta.includes('muse-spark-1.3-contributor'));
  const settings = museSettingsDocument({ command: '/usr/bin/node', args: ['/server.mjs'], env: { MOTION_MCP_JOURNAL: '/journal' } });
  assert.deepEqual(Object.keys(settings).sort(), ['mcpServers', 'schema_version']);
  assert.equal(settings.mcpServers['motion-transfer'].mode, 'required');
  const isolated = { config: '/tmp/mcp-config', data: '/tmp/mcp-data', state: '/tmp/mcp-state', cache: '/tmp/mcp-cache' };
  const env = museChildEnv(isolated, { ...process.env, CODEX_HOME: '/tmp/codex', MODEL_API_KEY: 'secret' });
  if (process.env.HOME) assert.equal(env.HOME, process.env.HOME);
  assert.equal(Object.hasOwn(env, 'CODEX_HOME'), false);
  assert.equal(Object.hasOwn(env, 'MODEL_API_KEY'), false);
  assert.equal(env.MUSE_AUTH_PATH, '/tmp/mcp-config/muse/auth.json');
  assert.equal(env.MUSE_NO_AUTO_UPDATE, '1');
  assert.equal(env.XDG_CONFIG_HOME, isolated.config);
  assert.equal(defaultMuseBinary(), join(homedir(), '.local', 'bin', `muse-bin-${PINNED_MUSE_VERSION}`));
  assert.equal(isPinnedMuseVersion('Muse Code 1.3.0 (1.3.0-R3057.1)'), true);
  assert.equal(isPinnedMuseVersion('Muse Code 1.3.0 (1.3.0-R3057.10)'), false);
  assert.equal(isPinnedMuseVersion('Muse Code 1.3.0 (1.3.0-R3401.1)'), false);
  let yielded = 0;
  let overflows = 0;
  const rest = appendJsonLine('', `${'x'.repeat(300_000)}\n{"ok":true}\n`, {
    onLine(line) { if (line === '{"ok":true}') yielded++; else throw Error('partial JSONL line was yielded'); },
    onOverflow() { overflows++; },
  });
  assert.equal(yielded, 1);
  assert.equal(overflows, 1);
  assert.equal(rest, '');
  const prompt = { payload_type: 'task.lifecycle.proposed', payload: { event: { task_kind: 'model.unknown.response', text: 'use the shell and the web' } } };
  assert.deepEqual(eventToolViolations([prompt]), []);
  assert.deepEqual(eventToolViolations([{ payload: { tool_name: 'shell' } }]), ['shell']);
});

test('the clean room task does not contain the saved component', async () => {
  const component = await readFile(new URL('../components/dashy-dango-dash/component.ts', import.meta.url), 'utf8');
  const distinctive = component.split('\n').find(line => line.length > 60);
  assert.ok(distinctive);
  const task = cleanRoomTask(createRecoveryProtocol());
  assert.equal(task.includes(distinctive), false);
  assert.match(task, /5 behavioral development attempts/);
  assert.match(task, /exit code is not success/);
});

test('stdio server lists typed tools and refuses an ungranted call', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, MOTION_MCP_JOURNAL: directory, MOTION_MCP_TURN_WAIT_MS: '200' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    }
  });
  const ask = message => new Promise(resolve => {
    pending.set(message.id, resolve);
    child.stdin.write(JSON.stringify(message) + '\n');
  });
  try {
    const initialized = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(initialized.result.serverInfo.name, 'motion-transfer');
    assert.equal(initialized.result.protocolVersion, '2025-06-18');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = listed.result.tools.map(tool => tool.name);
    for (const name of ['inspect_wasm', 'select_component_evidence', 'submit_component_candidate', 'freeze_component', 'accept_component']) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(names.some(name => /shell|web_search|fetch_url/.test(name)), false);
    const refused = await ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'inspect_wasm', arguments: { turn: 5 } } });
    assert.equal(refused.result.isError, true);
    assert.match(refused.result.content[0].text, /trusted model turn/);
    const forged = await ask({ jsonrpc: '2.0', id: 4, method: 'turn/grant', params: { turn: 0 } });
    assert.equal(forged.error.code, -32601);
    const stillRefused = await ask({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'inspect_wasm', arguments: { turn: 0 } } });
    assert.equal(stillRefused.result.isError, true);
    assert.match(stillRefused.result.content[0].text, /trusted model turn/);
    const badParams = await ask({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { arguments: { turn: 1 } } });
    assert.equal(badParams.error.code, -32602);
    const invalid = await new Promise(resolve => {
      pending.set(null, resolve);
      child.stdin.write('null\n');
    });
    assert.equal(invalid.error.code, -32600);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    assert.equal(report.toolCalls.length, 0);
  } finally {
    child.stdin.end();
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 0);
    await rm(directory, { recursive: true, force: true });
  }
});

test('stage, attempt, freeze, and one-acceptance gates wrap the workbench', { timeout: 120_000 }, async () => {
  const protocol = createRecoveryProtocol();
  const target = await loadTarget();
  const evaluate = async text => {
    const compiled = await compileMotion(text);
    return { passed: true, sourceSha256: compiled.sourceSha256, javascriptSha256: compiled.javascriptSha256, results: [{ passed: true, name: 'fixture' }] };
  };
  const directory = await mkdtemp(join(tmpdir(), 'mcp-gates-'));
  try {
    const session = await createInvestigationSession(target.bytes, undefined, { recoveryProtocol: protocol });
    const workbench = createComponentWorkbench(session, { evaluate, seed: () => 123 });
    const authority = createTurnAuthority();
    let dispatched = 0;
    const host = await createMotionHost({
      directory, protocol, authority,
      target: { id: target.id, sha256: target.sha256, byteLength: target.bytes.length },
      sessionSource: () => session.snapshot(),
      dispatch: async (name, args) => { dispatched++; return workbench.execute(name, args); },
    });
    authority.grant(0);
    const uninspected = await host.call('select_component_evidence', { functionIndices: [3], evidenceIds: ['missing'], scope: 'Uninspected.' });
    assert.equal(uninspected.entry.ok, false);
    assert.match(uninspected.entry.error, /Inspect or decompile/);
    assert.equal(dispatched, 1);
    session.recordStatic({ id: 'binary:func9', functionIndex: 9, kind: 'wat' });
    const observed = (await session.execute('session_advance', { branchId: 'main', hypothesis: 'Collect test evidence without model calls.', watches: [], steps: [{ buttons: 1, frames: 1, checkpoint: 'entered' }] })).result.checkpoints[0];
    const selected = (await workbench.execute('select_component_evidence', { functionIndices: [9], evidenceIds: [observed.observationId], scope: 'Offline fixture for the workbench protocol.' })).result;
    host.report.toolCalls.push(
      { callId: 'experiment', name: 'run_experiment', ok: true, requestAttempt: 1, result: { status: 'completed', experimentId: observed.observationId, artifactRef: { id: 'a'.repeat(64) }, initialEditDifference: { edits: [{ value: 1 }] }, frameCount: 8 } },
      { callId: 'selection', name: 'select_component_evidence', ok: true, requestAttempt: 2, result: { selectionId: selected.selectionId } },
    );
    host.report.session = session.snapshot();
    const candidate = {
      selectionId: selected.selectionId, source, timerFields: { cooldown: 'cooldown', remaining: 'remaining' },
      contract: { name: 'offline fixture', scope: 'Motion only.', defaults: { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 10 }, stateDescription: 'Integer counters.', rules: [{ description: 'A deliberately incomplete fixture.', evidence: ['binary:func9', observed.observationId] }], limitations: ['No independent recovery is claimed by this fixture.'] },
    };
    authority.grant(2);
    const submitted = await host.call('submit_component_candidate', candidate);
    assert.equal(submitted.entry.ok, true, submitted.entry.error);
    assert.equal(submitted.entry.result.development.passed, true);
    assert.equal(submitted.entry.requestAttempt, 3);
    const names = host.listTools().map(tool => tool.name);
    assert.ok(names.includes('freeze_component') && names.includes('inspect_wasm'));
    const frozen = await host.call('freeze_component', { candidateId: submitted.entry.result.candidateId });
    assert.equal(frozen.entry.ok, true, frozen.entry.error);
    const revised = await host.call('submit_component_candidate', candidate);
    assert.match(revised.entry.error, /not available in the current recovery stage/);
    const beforeAccept = dispatched;
    const accepted = await host.call('accept_component', { candidateId: submitted.entry.result.candidateId });
    assert.equal(accepted.entry.ok, true, accepted.entry.error);
    assert.equal(accepted.entry.result.passed, true);
    const second = await host.call('accept_component', { candidateId: submitted.entry.result.candidateId });
    assert.match(second.entry.error, /not available in the current recovery stage/);
    assert.equal(dispatched, beforeAccept + 1);
    await assert.rejects(workbench.execute('accept_component', { candidateId: submitted.entry.result.candidateId }), /once only/);

    const limited = await createInvestigationSession(target.bytes, undefined, { recoveryProtocol: protocol });
    const limitedBench = createComponentWorkbench(limited, { evaluate, seed: () => 7 });
    limited.recordStatic({ id: 'binary:func9', functionIndex: 9, kind: 'wat' });
    const again = (await limited.execute('session_advance', { branchId: 'main', hypothesis: 'Collect test evidence without model calls.', watches: [], steps: [{ buttons: 1, frames: 1, checkpoint: 'entered' }] })).result.checkpoints[0];
    const limitedSelection = (await limitedBench.execute('select_component_evidence', { functionIndices: [9], evidenceIds: [again.observationId], scope: 'Attempt limit fixture.' })).result;
    const limitedCandidate = { ...candidate, selectionId: limitedSelection.selectionId, contract: { ...candidate.contract, rules: [{ description: 'A deliberately incomplete fixture.', evidence: ['binary:func9', again.observationId] }] } };
    for (let attempt = 0; attempt < 5; attempt++) await limitedBench.execute('submit_component_candidate', limitedCandidate);
    const limitDir = join(directory, 'limit');
    const limitAuthority = createTurnAuthority();
    let limitDispatched = 0;
    const limitHost = await createMotionHost({
      directory: limitDir, protocol, authority: limitAuthority,
      target: { id: target.id, sha256: target.sha256, byteLength: target.bytes.length },
      sessionSource: () => limited.snapshot(),
      dispatch: async (name, args) => { limitDispatched++; return limitedBench.execute(name, args); },
    });
    limitHost.report.session = limited.snapshot();
    limitAuthority.grant(0);
    const blocked = await limitHost.call('submit_component_candidate', limitedCandidate);
    assert.match(blocked.entry.error, /not available in the current recovery stage/);
    assert.equal(limitDispatched, 0);
    await assert.rejects(limitedBench.execute('submit_component_candidate', limitedCandidate), /attempt limit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
