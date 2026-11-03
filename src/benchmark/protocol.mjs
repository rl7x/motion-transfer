import { repositoryPath, repositoryUrl } from '../paths.mjs';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';

export async function currentBenchmarkProtocol() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map(repositoryPath);
  const paths = [...new Set([...tracked, 'src/paths.mjs'])].filter(path =>
    (/^src\/(agent|benchmark|component|evaluator|experiment|integration|lab|remix|runtime|transfer|roadster)\//.test(path)
      || /^assets\/benchmark\/(fidelity|remix)-recordings\//.test(path)
      || ['src/paths.mjs', 'web/server.mjs', 'scripts/benchmark-developer.mjs', 'scripts/verify-developer-benchmark.mjs'].includes(path))
    && !path.includes('/recordings/') && !path.endsWith('.md') && !path.endsWith('.png'));
  const files = Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, digest(await readFile(repositoryUrl(path)))])));
  const controls = { model: 'muse-spark-1.3', recoveryMaxUsd: 0.5, maxModelCalls: 16, maxToolCalls: 24,
    maxRecoveryTrials: 3, campaignMaxUsd: 2, providerRetries: false };
  return { sha256: digest(JSON.stringify({ files, controls })), files, controls,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version };
}
