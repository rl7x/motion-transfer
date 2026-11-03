import { benchmarkStore } from './store.mjs';
import { fileURLToPath } from 'node:url';
import { passedSuite } from './metrics.mjs';

export function developerBenchmarkAssets({ directory = fileURLToPath(new URL('../../reports/developer-benchmark/', import.meta.url)), savedDirectory } = {}) {
  const store = benchmarkStore(directory, { ...(savedDirectory ? { savedDirectory } : {}) });
  return async path => {
    if (path === '/api/developer-benchmarks') {
      const campaigns = await store.list();
      return { type: 'application/json', body: JSON.stringify(campaigns.map(({ id, status, definition, summary, updatedAt }) => ({
        id, status, origin: definition.origin, createdAt: definition.createdAt, updatedAt, summary,
      }))) };
    }
    const match = path.match(/^\/(api\/developer-benchmarks|developer-benchmarks)\/([a-f0-9-]{36})(?:\/([a-f0-9-]{36})\/(source|verification|report|play\.html))?$/);
    if (!match) return null;
    const [, prefix, id, attemptId, file] = match;
    const campaign = await store.read(id);
    if (!attemptId) return prefix === 'api/developer-benchmarks' ? { type: 'application/json', body: JSON.stringify(campaign) } : null;
    const attempt = campaign.attempts.find(item => item.id === attemptId);
    if (file === 'report' && attempt?.jobRef) return { type: 'application/json',
      body: JSON.stringify(await store.evidence(id, attempt.jobRef.sha256)), download: 'benchmark-' + attempt.stage + '-report.json' };
    if (!attempt?.artifactRef) return null;
    const artifact = await store.evidence(id, attempt.artifactRef.sha256);
    if (file === 'source') return { type: 'application/json', body: JSON.stringify(artifact), download: 'benchmark-' + attempt.stage + '.json' };
    if (file === 'verification') return { type: 'application/json', body: JSON.stringify(artifact.verification ?? artifact.evaluation ?? JSON.parse(artifact.files?.['verification.json'] ?? '{}')) };
    if (file === 'play.html' && attempt.stage !== 'recovery') {
      const verification = artifact.evaluation ?? JSON.parse(artifact.files?.['verification.json'] ?? '{}');
      if (!passedSuite(verification.conformance) || !passedSuite(verification.browser)) throw Error('Only verified benchmark artifacts are playable');
      const html = artifact.html ?? artifact.files?.['frame.html'];
      if (typeof html !== 'string') throw Error('Playable benchmark artifact is missing');
      return { type: 'text/html', body: html, sandbox: true };
    }
    return null;
  };
}
