import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { FRAME_LIMIT, JOB_LIMIT, STDOUT_LIMIT, VERIFIER_IMAGE } from './constants.mjs';
import { isolationError } from './errors.mjs';
import { workerArguments } from './isolation.mjs';
import { parseJob } from './protocol.mjs';

const execute = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const ALLOWED_OUTPUT = new Set(['result.json', 'frame.html']);

function scrub(text) {
  let value = String(text ?? '');
  const marker = process.env.HOSTING_SECRET_MARKER;
  if (marker) value = value.replaceAll(marker, '[redacted]');
  return value.slice(0, 500);
}

function assertCleanEnvironment(envText) {
  const marker = process.env.HOSTING_SECRET_MARKER;
  if (marker && envText.includes(marker)) throw Error('Worker environment received a credential');
  let entries;
  try { entries = JSON.parse(envText); }
  catch { throw Error('Worker environment could not be read'); }
  if (!Array.isArray(entries)) throw Error('Worker environment could not be read');
  const names = entries.map(entry => String(entry).split('=')[0]);
  for (const name of names) {
    if (['HOSTING_SECRET_MARKER', 'MODEL_API_KEY', 'META_API_KEY', 'AUTHORIZATION'].includes(name)) {
      throw Error('Worker environment received a credential');
    }
  }
  return names;
}

async function inspectContainer(name) {
  const { stdout } = await execute('docker', ['inspect', '--format', '{{.State.OOMKilled}}\t{{.State.ExitCode}}\t{{json .Config.Env}}', name], { timeout: 10_000 });
  const [oom, code, envText] = stdout.trim().split('\t');
  return { oomKilled: oom === 'true', exitCode: Number(code), envNames: assertCleanEnvironment(envText ?? '[]') };
}

function runContainer({ args, stdin, timeoutMs, name }) {
  return new Promise(resolveRun => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let outBytes = 0;
    let timedOut = false;
    let exceeded = false;
    let closed = false;
    let killTimer = null;
    const stop = () => {
      if (killTimer) return;
      const attempt = () => {
        if (closed) return;
        const killer = spawn('docker', ['kill', name], { stdio: 'ignore' });
        killer.unref();
        killTimer = setTimeout(attempt, 300);
      };
      attempt();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const hardStop = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, timeoutMs + 20_000);
    child.stdout.on('data', chunk => {
      outBytes += chunk.length;
      if (outBytes > STDOUT_LIMIT) { exceeded = true; stop(); return; }
      stdout.push(chunk);
    });
    child.stderr.on('data', chunk => { if (stderr.length < 8) stderr.push(chunk); });
    child.stdin.on('error', () => {});
    child.on('error', error => {
      closed = true; clearTimeout(timer); clearTimeout(hardStop); clearTimeout(killTimer);
      resolveRun({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(error.message), timedOut, exceeded, spawnError: true });
    });
    child.on('close', code => {
      closed = true; clearTimeout(timer); clearTimeout(hardStop); clearTimeout(killTimer);
      resolveRun({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), timedOut, exceeded });
    });
    child.stdin.end(stdin);
  });
}

async function readOutput(directory, stdoutText, result) {
  const names = (await readdir(directory)).filter(name => name !== '.' && name !== '..');
  for (const name of names) if (!ALLOWED_OUTPUT.has(name)) throw Error('Worker wrote an unexpected output file');
  const receipt = await readFile(join(directory, 'result.json'), 'utf8');
  if (receipt !== stdoutText) throw Error('Worker result did not match its output file');
  if (!result.frame) return null;
  if (!names.includes('frame.html')) throw Error('Verified frame was not written');
  const frame = await readFile(join(directory, 'frame.html'));
  if (frame.length > FRAME_LIMIT || frame.length !== result.frame.bytes) throw Error('Verified frame exceeds the output limit');
  if (digest(frame) !== result.frame.sha256) throw Error('Verified frame hash mismatch');
  return frame;
}

export async function dockerRun(image, job) {
  const name = `mt-${randomBytes(8).toString('hex')}`;
  const outputDir = job.operation.startsWith('verify-') ? join(tmpdir(), name) : null;
  if (outputDir) { await mkdir(outputDir, { recursive: true }); await chmod(outputDir, 0o777); }
  const spec = workerArguments({ image, name, operation: job.operation, outputDir: outputDir ?? undefined });
  let inspected = null;
  try {
    const run = await runContainer({ args: spec.args, stdin: JSON.stringify(job), timeoutMs: spec.timeoutMs, name });
    try { inspected = await inspectContainer(name); }
    catch (error) {
      if (run.spawnError) throw isolationError();
      throw error;
    }
    if (process.env.HOSTING_SECRET_MARKER && run.stderr.includes(process.env.HOSTING_SECRET_MARKER)) {
      throw Error('Worker output received a credential');
    }
    let terminated = null;
    if (run.exceeded) terminated = 'output-limit';
    else if (run.timedOut) terminated = 'timeout';
    else if (inspected?.oomKilled || inspected?.exitCode === 137) terminated = 'oom';
    const stdoutText = run.stdout.toString('utf8');
    let result = null;
    if (!terminated && stdoutText) {
      try { result = JSON.parse(stdoutText); }
      catch { throw Error(`Worker returned invalid JSON: ${scrub(run.stderr)}`); }
    }
    const completed = !terminated && result?.ok === true && (inspected?.exitCode ?? run.code) === 0;
    const frame = completed && outputDir ? await readOutput(outputDir, stdoutText, result) : null;
    const ok = completed;
    return {
      ok, terminated, exitCode: inspected?.exitCode ?? run.code, oomKilled: inspected?.oomKilled === true,
      envNames: inspected?.envNames ?? [], result, frame, error: ok ? null : scrub(result?.error || run.stderr || terminated || 'worker failed'),
    };
  } finally {
    await execute('docker', ['rm', '-f', name], { timeout: 10_000 }).catch(() => {});
    if (outputDir) await rm(outputDir, { recursive: true, force: true });
  }
}

export async function createWorkerBroker({ image = VERIFIER_IMAGE, run, socketPath } = {}) {
  let chain = Promise.resolve();
  const launch = run ?? (job => dockerRun(image, job));
  async function submit(input) {
    const job = parseJob(input);
    const pending = chain.then(() => launch(job));
    chain = pending.catch(() => {});
    return pending;
  }
  async function available() {
    if (run) return true;
    try {
      await execute('docker', ['image', 'inspect', image], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }
  let server = null;
  if (socketPath) {
    await rm(socketPath, { force: true });
    server = createServer({ allowHalfOpen: true }, socket => {
      const chunks = [];
      let size = 0;
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        const text = JSON.stringify(value.frame ? { ...value, frame: undefined, frameBase64: value.frame.toString('base64') } : value);
        if (Buffer.byteLength(text) > FRAME_LIMIT + 2 * 1024 * 1024) {
          socket.end(JSON.stringify({ ok: false, error: 'Worker response exceeds output limit' }));
          return;
        }
        socket.end(text);
      };
      socket.on('data', chunk => {
        size += chunk.length;
        if (size > JOB_LIMIT) { finish({ ok: false, error: 'Job exceeds 256 KB' }); socket.destroy(); return; }
        chunks.push(chunk);
      });
      socket.on('end', () => {
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { finish({ ok: false, error: 'Worker job is not JSON' }); return; }
        submit(input).then(finish, error => finish({ ok: false, error: scrub(error.message) }));
      });
      socket.on('error', () => {});
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(socketPath, resolveListen); });
  }
  return {
    submit, available, image,
    async close() {
      if (server) await new Promise(resolveClose => server.close(resolveClose));
      if (socketPath) await rm(socketPath, { force: true });
      await chain.catch(() => {});
    },
  };
}
