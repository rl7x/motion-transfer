import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { currentBenchmarkProtocol } from '../benchmark/protocol.mjs';
import { digest } from '../component/build.mjs';

const exec = promisify(execFile), protocol = await currentBenchmarkProtocol();
const checks = [];
for (const script of ['test', 'typecheck', 'lint', 'format:check', 'build:frontend']) {
  let exitCode = 0, output = '';
  try { const result = await exec('npm', ['run', script], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR }, timeout: 600000, maxBuffer: 4 * 1024 * 1024 }); output = result.stdout + result.stderr; }
  catch (error) { exitCode = Number.isInteger(error.code) ? error.code : 1; output = String(error.stdout ?? '') + String(error.stderr ?? '') + '\n' + error.message; }
  await mkdir(new URL('../reports/developer-benchmark/', import.meta.url), { recursive: true });
  const path = new URL('../reports/developer-benchmark/check-' + script.replaceAll(':', '-') + '.log', import.meta.url);
  await writeFile(path, output);
  checks.push({ command: 'npm run ' + script, exitCode, outputSha256: digest(output) });
  console.log('npm run ' + script + ': ' + (exitCode === 0 ? 'passed' : 'failed'));
  if (exitCode) break;
}
const finalProtocol = await currentBenchmarkProtocol();
const report = { schemaVersion: 1, kind: 'local-verification', metaCalled: false, protocolSha256: protocol.sha256,
  passed: checks.length === 5 && checks.every(check => check.exitCode === 0) && protocol.sha256 === finalProtocol.sha256,
  node: process.version, finishedAt: new Date().toISOString(), checks };
await writeFile(new URL('../reports/developer-benchmark/validation.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
