import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';

export async function currentBenchmarkProtocol() {
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(path => path
    && /^(agent|benchmark|component|evaluator|experiment|integration|lab|remix|runtime|transfer)\//.test(path)
    && !path.includes('/recordings/') && !path.endsWith('.md') && !path.endsWith('.png'));
  const files = Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, digest(await readFile(path))])));
  const controls = { model: 'muse-spark-1.3', recoveryMaxUsd: 0.5, maxModelCalls: 16, maxToolCalls: 24,
    maxRecoveryTrials: 3, campaignMaxUsd: 2, providerRetries: false };
  return { sha256: digest(JSON.stringify({ files, controls })), files, controls,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version };
}
