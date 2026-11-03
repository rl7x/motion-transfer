import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createPhaseBudget } from '../campaign/phase-budget.mjs';
import { createRecoveryProtocol } from '../agent/recovery-protocol.mjs';
import {
  MAX_JSON_LINE_BYTES, PINNED_MUSE_VERSION, appendJsonLine, defaultMuseBinary, eventToolViolations, isPinnedMuseVersion,
  museChildEnv, museExecArgs, musePreflightAvailability, museSettingsDocument, museSpendControl, trustedTurnBefore,
} from './control.mjs';
import { cleanRoomTask } from './host.mjs';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));

async function filesUnder(root) {
  const found = [];
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  await walk(root);
  return found.sort();
}

function listenGrants(socketPath) {
  const sockets = new Set();
  let latest = null;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
    if (latest !== null) socket.write(JSON.stringify({ turn: latest }) + '\n');
  });
  return {
    ready: new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    }),
    grant(turn) {
      latest = turn;
      const line = JSON.stringify({ turn }) + '\n';
      for (const socket of sockets) socket.write(line);
    },
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

function spawnMuse(binary, args, env, onEvent, sandboxPath) {
  if (!sandboxPath) throw Error('sandbox-exec is required');
  const deny = join(homedir(), '.config', 'muse');
  const profile = `(version 1)\n(allow default)\n(deny file-read* file-write* (subpath ${JSON.stringify(deny)}))\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(sandboxPath, ['-p', profile, binary, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', rest = '', overflow = false, settled = false, exposedDefaultConfig = false;
    let stdoutTail = '', stderrTail = '';
    const events = [];
    const finish = (value, failed) => {
      if (settled) return;
      settled = true;
      if (failed) reject(value);
      else resolve(value);
    };
    const watch = (tail, text) => {
      const window = tail + text;
      if (window.includes(deny)) exposedDefaultConfig = true;
      return window.slice(-deny.length);
    };
    const capture = (current, text) => {
      if (Buffer.byteLength(current) >= MAX_JSON_LINE_BYTES) return current;
      const next = current + text;
      if (Buffer.byteLength(next) <= MAX_JSON_LINE_BYTES) return next;
      return Buffer.from(next).subarray(0, MAX_JSON_LINE_BYTES).toString('utf8');
    };
    child.on('error', error => finish(error, true));
    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      stdoutTail = watch(stdoutTail, text);
      stdout = capture(stdout, text);
      rest = appendJsonLine(rest, chunk, {
        onLine(line) {
          if (!line.trim()) return;
          try {
            const event = JSON.parse(line);
            if (events.length >= 1024) { overflow = true; return; }
            events.push(event);
            onEvent?.(event, events);
          } catch { /* non-JSON stdout stays out of the event list */ }
        },
        onOverflow() { overflow = true; },
      });
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderrTail = watch(stderrTail, text);
      stderr = capture(stderr, text);
    });
    child.on('close', code => finish({ code, stdout, stderr, events, overflow, exposedDefaultConfig }, false));
  });
}

async function defaultAuthStamp() {
  try { return (await stat(join(homedir(), '.config', 'muse', 'auth.json'))).mtimeMs; }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw Error('Preflight could not compare default Muse auth metadata');
  }
}

async function readPhaseLedger(phaseLedger) {
  const path = join(phaseLedger, 'phase-budget.json');
  try { await stat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return { present: false, uncertain: null, overrun: null, remainingUsd: null, reservations: null };
    throw error;
  }
  const phaseBudget = await createPhaseBudget(phaseLedger);
  const status = await phaseBudget.status();
  return {
    present: true, uncertain: status.uncertain, overrun: status.overrun,
    remainingUsd: status.remainingUsd, reservations: status.reservations,
  };
}

async function assertVersion(binary, env, sandboxPath) {
  const result = await spawnMuse(binary, ['--version'], env, undefined, sandboxPath);
  const version = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0 || result.overflow || !isPinnedMuseVersion(version)) {
    throw Error(`Muse binary is not the pinned ${PINNED_MUSE_VERSION} build`);
  }
  return version;
}

export async function runEchoPreflight({
  binary = defaultMuseBinary(), out, phaseLedger,
} = {}) {
  if (!out || !phaseLedger) throw Error('Preflight requires an output directory and the phase ledger');
  const support = await musePreflightAvailability({ binary });
  if (!support.ok) throw Error(support.reason);
  binary = support.binary;
  const protocol = createRecoveryProtocol();
  const task = cleanRoomTask(protocol);
  const probeEnv = museChildEnv({
    config: join(out, 'version-config'), data: join(out, 'version-data'),
    state: join(out, 'version-state'), cache: join(out, 'version-cache'),
  });
  await mkdir(probeEnv.XDG_CONFIG_HOME, { recursive: true });
  const version = await assertVersion(binary, probeEnv, support.sandboxPath);
  const authBefore = await defaultAuthStamp();
  const good = await runCase({ binary, sandboxPath: support.sandboxPath, root: join(out, 'good'), task, mode: 'server' });
  const crashed = await runCase({ binary, sandboxPath: support.sandboxPath, root: join(out, 'required'), task, mode: 'crash' });
  const dropped = await runCase({ binary, sandboxPath: support.sandboxPath, root: join(out, 'both-keys'), task, mode: 'both' });
  const legacy = await runCase({ binary, sandboxPath: support.sandboxPath, root: join(out, 'legacy-key'), task, mode: 'legacy' });
  const authAfter = await defaultAuthStamp();
  if (authBefore !== authAfter) throw Error('Preflight changed the default Muse auth file');
  const phase = await readPhaseLedger(phaseLedger);
  const control = museSpendControl();
  const limitations = [
    'Echo preflight does not call Meta and is not a recovery. accepted is false and there is no j/3 rate.',
    'muse exec --max-model-steps is not a dollar or token bound. Paid runs stay refused until a provider reports usage before the next request and the host can refuse that request.',
    control.reason,
    'Echo rejects --reasoning-effort and --api-key-stdin. Those flags exist only on the unexecuted paid argv.',
    'This build loads mcpServers. A file that also contains mcp_servers drops every MCP server. A lone mcp_servers key still loads on this binary; the writer emits only mcpServers with mode required.',
    'MCP servers run outside the client sandbox, so this server exposes only the typed workbench tools.',
    good.usageEvents === 0
      ? 'The echo stream contained no input_tokens or output_tokens fields, so this run did not meter a dollar bound.'
      : 'Usage fields appeared only in the completed echo stream. They still cannot refuse the next billed request.',
    'The echo provider reported no tool call, so live turn binding was not exercised. Trusted turns are tested against the observed event shape and are not taken from tool arguments.',
    'This echo preflight is not a Muse recovery. tools/call stays refused unless a trusted turn is granted on MOTION_MCP_TURN_SOCKET, and a normal Muse session has no such socket. Echo does not make the workbench operational.',
    'Bundled reminder tasks can still appear with --no-foreign-personal-context. They are not shell or web tools.',
    'HOME is preserved and is never reassigned. CODEX_HOME and provider credentials are not forwarded. sandbox-exec denies the default Muse config directory.',
  ];
  if (!phase.present) limitations.push('The phase ledger is absent. This preflight did not create a replacement journal and did not reserve spend.');
  if (good.events.some(event => JSON.stringify(event).includes('provider does not support base instructions'))) {
    limitations.push('Echo completed with exit 0 while a model task failed: provider does not support base instructions. Exit status is not acceptance.');
  }
  if (phase.present && (phase.uncertain || phase.overrun)) {
    limitations.push('The shared phase ledger is uncertain or overrun. This preflight did not settle, reset, or reserve against it. A later reserve would be refused.');
  }
  const checks = {
    versionPinned: isPinnedMuseVersion(version),
    homePreserved: !probeEnv.HOME || probeEnv.HOME === process.env.HOME,
    codexHomeOmitted: !Object.hasOwn(probeEnv, 'CODEX_HOME'),
    serverStarted: good.started,
    workspaceOnlyTask: good.workspaceOnlyTask,
    requiredServerAborts: crashed.code === 1 && /Required MCP server/.test(`${crashed.stderr}\n${JSON.stringify(crashed.events)}`),
    bothKeysDropServer: dropped.code === 0 && dropped.markerStarted === false,
    legacyKeyStillLoads: legacy.code === 1 && /Required MCP server/.test(`${legacy.stderr}\n${JSON.stringify(legacy.events)}`),
    noBlockedTools: good.violations.length === 0,
    trustedGenerations: good.generations,
    usageEvents: good.usageEvents,
    paidSpendRefused: control.enforceable === false,
    paidTurnOrderingRefused: control.turnOrdering === false,
    defaultAuthUnchanged: authBefore === authAfter,
    defaultConfigPathHidden: [good, crashed, dropped, legacy].every(item => item.exposedDefaultConfig !== true),
  };
  const failed = Object.entries(checks).filter(([key, value]) => key !== 'trustedGenerations' && key !== 'usageEvents' && value === false);
  if (good.generations < 1) failed.push(['trustedGenerations', false]);
  const result = {
    schemaVersion: 1, kind: 'muse-code-preflight', paidRun: false, accepted: false, recoveryRate: null,
    binary: { path: binary, version: PINNED_MUSE_VERSION }, checks, limitations,
    phaseLedger: {
      present: phase.present, uncertain: phase.uncertain, overrun: phase.overrun,
      remainingUsd: phase.remainingUsd, reservations: phase.reservations,
    },
  };
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'preflight.json'), JSON.stringify(result, null, 2) + '\n');
  if (failed.length) {
    const error = new Error('Muse echo preflight failed: ' + failed.map(([key]) => key).join(', '));
    error.result = result;
    throw error;
  }
  return result;
}

async function runCase({ binary, sandboxPath, root, task, mode }) {
  await rm(root, { recursive: true, force: true });
  const workspace = join(root, 'cleanroom');
  const journal = join(root, 'journal');
  const isolated = { config: join(root, 'config'), data: join(root, 'data'), state: join(root, 'state'), cache: join(root, 'cache') };
  await mkdir(workspace, { recursive: true });
  await mkdir(journal, { recursive: true });
  for (const path of Object.values(isolated)) await mkdir(path, { recursive: true });
  await writeFile(join(workspace, 'TASK.md'), task);
  const socketPath = join('/tmp', `mt-${process.pid}-${mode}.sock`);
  await rm(socketPath, { force: true });
  const grants = mode === 'server' ? listenGrants(socketPath) : null;
  if (grants) await grants.ready;
  const marker = join(root, 'marker');
  const crash = join(root, 'crash.mjs');
  await writeFile(crash, mode === 'both'
    ? `import { writeFile } from 'node:fs/promises'; await writeFile(process.env.MARKER, 'started');\nprocess.exit(1);\n`
    : 'process.exit(1);\n');
  const server = mode === 'server'
    ? { command: process.execPath, args: [serverPath], env: { MOTION_MCP_JOURNAL: journal, MOTION_MCP_TURN_SOCKET: socketPath } }
    : { command: process.execPath, args: [crash], env: mode === 'both' ? { MARKER: marker } : {} };
  const settings = museSettingsDocument(server);
  if (mode === 'both') settings.mcp_servers = settings.mcpServers;
  const document = mode === 'legacy'
    ? { schema_version: 1, mcp_servers: settings.mcpServers }
    : settings;
  await mkdir(join(isolated.config, 'muse'), { recursive: true });
  await writeFile(join(isolated.config, 'muse', 'settings.json'), JSON.stringify(document));
  const env = museChildEnv(isolated);
  const args = museExecArgs({ provider: 'echo', workspace, promptFile: join(workspace, 'TASK.md'), maxModelSteps: 1 });
  const result = await spawnMuse(binary, args, env, (_event, events) => {
    if (!grants) return;
    try { grants.grant(trustedTurnBefore(events, events.length)); } catch { /* not a trusted generation yet */ }
  }, sandboxPath);
  if (result.overflow) throw Error('Muse JSONL exceeded the input bound');
  if (grants) {
    await grants.close();
    await rm(socketPath, { force: true });
  }
  const seen = result.events;
  const workspaceFiles = await filesUnder(workspace);
  let started = false;
  try { await stat(join(journal, 'report.json')); started = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let markerStarted = false;
  try { await stat(marker); markerStarted = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const usageEvents = seen.filter(event => /input_tokens|output_tokens/.test(JSON.stringify(event?.payload ?? {}))).length;
  let generations = 0;
  try { generations = trustedTurnBefore(seen, seen.length) + 1; } catch { generations = 0; }
  return {
    code: result.code, stdout: result.stdout, stderr: result.stderr, events: seen, started, markerStarted, generations, usageEvents,
    exposedDefaultConfig: result.exposedDefaultConfig,
    violations: eventToolViolations(seen),
    workspaceOnlyTask: workspaceFiles.length === 1 && workspaceFiles[0] === join(workspace, 'TASK.md'),
  };
}
