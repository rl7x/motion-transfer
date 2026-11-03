import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function benchmarkTransport({ origin = 'http://127.0.0.1:4173', labDirectory, remixDirectory }) {
  assert.equal(new URL(origin).hostname, '127.0.0.1', 'Benchmarks use the loopback preview only');
  const get = async path => {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Preview read failed: ' + response.status + ' ' + path);
    return response.json();
  };
  const paku = stage => stage.startsWith('paku-');
  const submitPath = stage => paku(stage) ? '/api/remixes' : stage === 'recovery' ? '/api/investigations' : '/api/roadster/transfers';
  const runPath = stage => paku(stage) ? '/api/runs/' : stage === 'recovery' ? '/api/investigations/' : '/api/roadster/transfers/';
  return {
    origin: 'fresh-meta',
    async status(stage) { return get(paku(stage) ? '/api/remixes/status' : '/api/lab/status'); },
    async submit(stage, request) {
      const response = await fetch(origin + submitPath(stage), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error('Preview submission failed: ' + response.status + ' ' + await response.text());
      return response.json();
    },
    async run(stage, id) { assert.match(id, /^[a-f0-9-]{36}$/); return get(runPath(stage) + id); },
    async findSubmitted(stage, request) {
      const root = join(paku(stage) ? remixDirectory : labDirectory, 'jobs');
      const matches = [];
      for (const name of await readdir(root)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const job = JSON.parse(await readFile(join(root, name), 'utf8'));
        if (job.request.idempotencyKey === request.idempotencyKey) {
          assert.deepEqual(job.request, request, 'Recovered request input changed'); matches.push(job);
        }
      }
      assert.ok(matches.length <= 1, 'Ambiguous submitted request identity'); return matches[0] ?? null;
    },
    async evidenceJob(stage, job) {
      if (!paku(stage)) return job;
      const raw = JSON.parse(await readFile(join(remixDirectory, 'jobs', job.id + '.json'), 'utf8'));
      assert.equal(raw.id, job.id); return raw;
    },
    async artifact(stage, job) {
      if (stage === 'recovery') {
        const id = job.task?.integration?.id; assert.match(id, /^[a-f0-9]{64}$/);
        const [verification, receipt] = await Promise.all(['validation.json', 'receipt.json'].map(file => get('/recovery-projects/' + id + '/' + file)));
        return { kind: 'recovery-integration', id, verification, receipt };
      }
      assert.match(job.artifactId, /^[a-f0-9]{64}$/);
      return get(stage === 'roadster' ? '/api/roadster/artifacts/' + job.artifactId + '/source' : '/api/artifacts/' + job.artifactId + '/source');
    },
  };
}
