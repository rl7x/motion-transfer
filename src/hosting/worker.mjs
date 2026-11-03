import { createHash } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FRAME_LIMIT, STDOUT_LIMIT } from './constants.mjs';
import { parseJobText, summarizeChecks } from './protocol.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const ALLOWED_WRITES = new Set(['/tmp/hosting-probe', '/output/hosting-probe']);
const SECRET_NAMES = ['MODEL_API_KEY', 'META_API_KEY', 'HOSTING_SECRET_MARKER'];

function facts() {
  return { executedIn: 'worker', uid: typeof process.getuid === 'function' ? process.getuid() : null };
}

function secretNames() {
  return SECRET_NAMES.filter(name => typeof process.env[name] === 'string' && process.env[name].length > 0);
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 256 * 1024) throw Error('Job exceeds 256 KB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function tcp(host, port) {
  return new Promise(resolveProbe => {
    const socket = net.connect({ host, port });
    const done = (ok, code) => { socket.destroy(); resolveProbe({ kind: 'tcp', host, ok, code }); };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true, ''));
    socket.once('timeout', () => done(false, 'TIMEOUT'));
    socket.once('error', error => done(false, error.code ?? 'ERROR'));
  });
}

async function probeEgress() {
  const attempts = [await tcp('1.1.1.1', 443), await tcp('8.8.8.8', 53)];
  try {
    await Promise.race([
      dns.lookup('example.com'),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(Error('timeout'), { code: 'TIMEOUT' })), 1500)),
    ]);
    attempts.push({ kind: 'dns', ok: true, code: '' });
  } catch (error) {
    attempts.push({ kind: 'dns', ok: false, code: error.code ?? 'ERROR' });
  }
  try {
    await fetch('http://example.com/', { signal: AbortSignal.timeout(1500) });
    attempts.push({ kind: 'fetch', ok: true, code: '' });
  } catch (error) {
    attempts.push({ kind: 'fetch', ok: false, code: error.cause?.code ?? error.code ?? 'ERROR' });
  }
  const interfaces = (await readdir('/sys/class/net').catch(() => [])).sort();
  return { ok: true, operation: 'probe-egress', egress: attempts.some(attempt => attempt.ok), attempts, interfaces, ...facts() };
}

async function probeWrite() {
  const { writeFile: write } = await import('node:fs/promises');
  const writes = {};
  for (const path of ['/etc/hosting-probe', '/usr/hosting-probe', '/app/hosting-probe', '/home/verifier/hosting-probe', '/tmp/hosting-probe', '/output/hosting-probe']) {
    try {
      await write(path, 'probe');
      writes[path] = 'ok';
    } catch (error) {
      writes[path] = error.code ?? 'ERROR';
    }
  }
  const escaped = Object.entries(writes).some(([path, result]) => result === 'ok' && !ALLOWED_WRITES.has(path));
  return { ok: true, operation: 'probe-write', writes, escaped, ...facts() };
}

async function boundComponent(job) {
  const { loadPinnedComponent } = await import('./component-load.mjs');
  const component = await loadPinnedComponent(job.componentId);
  if (component.provenance.id !== job.componentId) throw Error('Verifier component identity changed');
  return component;
}

export async function verifyNative(job) {
  if (secretNames().length) throw Error('Worker refuses to run with credentials in the environment');
  const component = await boundComponent(job);
  const { evaluateRoadsterAdapter } = await import('../evaluator/roadster.mjs');
  const evaluate = job.recipientId === 'parallaxia' ? (await import('../evaluator/parallaxia.mjs')).evaluateParallaxiaAdapter : evaluateRoadsterAdapter;
  const report = await evaluate(job.source, job.intent, { componentRef: component, ruleSource: job.ruleSource });
  if (report.componentId !== job.componentId) throw Error('Verifier component identity changed');
  const checks = summarizeChecks(report.results);
  const recipe = job.recipientId==='parallaxia' ? (await import('../parallaxia/rule.mjs')).readRuleSource(job.ruleSource) : null;
  const ruleId = recipe ? digest(job.ruleSource) : null;
  const result = {
    ok: true, operation: 'verify-native', passed: report.passed === true, gate: report.gate,
    componentId: report.componentId, sourceSha256: report.sourceSha256, javascriptSha256: report.javascriptSha256,
    ruleId, ruleKind: recipe ? 'dash-end-shot' : 'none', intent: job.intent, ...(job.recipientId ? { recipientId: job.recipientId } : {}), checks, results: checks, javascript: null, ...facts(),
  };
  if (result.passed) {
    const { compileAdapter } = await import('../transfer/adapter.mjs');
    const compiled = await compileAdapter(job.source, { componentRef: component });
    if (compiled.javascriptSha256 !== report.javascriptSha256 || compiled.componentId !== job.componentId) {
      throw Error('Compiled adapter hash changed');
    }
    if (Buffer.byteLength(compiled.javascript) > 32 * 1024) throw Error('Compiled adapter exceeds the output limit');
    result.javascript = compiled.javascript;
  }
  return result;
}

async function verifyBrowser(job) {
  if (secretNames().length) throw Error('Worker refuses to run with credentials in the environment');
  const component = await boundComponent(job);
  const { verifyRoadsterBrowser } = await import('../evaluator/roadster-browser.mjs');
  const { buildRoadsterFrame } = await import('../roadster/build.mjs');
  const verify = job.recipientId === 'parallaxia' ? (await import('../evaluator/parallaxia-browser.mjs')).verifyParallaxiaBrowser : verifyRoadsterBrowser;
  const build = job.recipientId === 'parallaxia' ? (await import('../parallaxia/build.mjs')).buildParallaxiaFrame : buildRoadsterFrame;
  const report = await verify(job.source, job.intent, { componentRef: component, ruleSource: job.ruleSource });
  if (report.componentId !== job.componentId) throw Error('Verifier component identity changed');
  const checks = summarizeChecks(report.results);
  const recipe = job.recipientId==='parallaxia' ? (await import('../parallaxia/rule.mjs')).readRuleSource(job.ruleSource) : null;
  const ruleId = recipe ? digest(job.ruleSource) : null;
  const result = {
    ok: true, operation: 'verify-browser', passed: report.passed === true, gate: report.gate,
    componentId: report.componentId, sourceSha256: report.sourceSha256, frameSha256: report.frameSha256,
    ruleId, ruleKind: recipe ? 'dash-end-shot' : 'none', intent: job.intent, ...(job.recipientId ? { recipientId: job.recipientId } : {}), checks, results: checks, frame: null, ...facts(),
  };
  if (result.passed) {
    const built = await build({ source: job.source, intent: job.intent, componentRef: component, ruleSource: job.ruleSource });
    if (built.environment?.componentId !== job.componentId) throw Error('Verifier component identity changed');
    const hash = digest(built.html);
    if (hash !== report.frameSha256) throw Error('Frame hash changed after browser verification');
    const bytes = Buffer.byteLength(built.html);
    if (bytes > FRAME_LIMIT) throw Error('Verified frame exceeds the output limit');
    await writeFile('/output/frame.html', built.html, { mode: 0o644 });
    result.frame = { sha256: hash, bytes };
    result.environment = built.environment;
  }
  return result;
}

async function dispatch(job) {
  if (['verify-checkpoint','verify-experiment'].includes(job.operation)) {
    if (secretNames().length) throw Error('Worker refuses credentials');
    const component = await boundComponent(job);
    const {verifyCheckpointJob} = await import('./experiment.mjs');
    return {ok:true,passed:true,operation:job.operation,recipientId:'parallaxia',componentId:job.componentId,sourceSha256:digest(job.source),...await verifyCheckpointJob(job,component),...facts()};
  }
  if (job.operation === 'probe-egress') return probeEgress();
  if (job.operation === 'probe-env') {
    const present = secretNames();
    return {
      ok: true, operation: 'probe-env', ...facts(),
      markerSeen: present.includes('HOSTING_SECRET_MARKER'),
      credentialPresent: present.some(name => name !== 'HOSTING_SECRET_MARKER'),
    };
  }
  if (job.operation === 'probe-write') return probeWrite();
  if (job.operation === 'verify-native') return verifyNative(job);
  if (job.operation === 'verify-browser') return verifyBrowser(job);
  throw Error('Unknown hosting operation');
}

async function main() {
  const job = parseJobText(await readStdin());
  // These two probes must be able to die by signal. Do not catch their failures.
  if (job.operation === 'probe-spin') for (;;) { /* broker deadline */ }
  if (job.operation === 'probe-memory') {
    const chunks = [];
    try {
      for (;;) chunks.push(Buffer.alloc(1024 * 1024, 1));
    } catch {
      process.kill(process.pid, 'SIGKILL');
    }
  }
  try {
    const result = await dispatch(job);
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > STDOUT_LIMIT) throw Error('Result exceeds output limit');
    if (job.operation.startsWith('verify-')) await writeFile('/output/result.json', text, { mode: 0o644 });
    process.stdout.write(text);
  } catch (error) {
    const text = JSON.stringify({ ok: false, error: String(error.message ?? error).slice(0, 500), ...facts() });
    process.stdout.write(text);
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) await main();
