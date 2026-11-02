import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest } from '../component/build.mjs';
import { campaignMetrics } from './metrics.mjs';

const validId = id => assert.match(id, /^[a-f0-9-]{36}$/, 'Invalid benchmark identity');
const validHash = id => assert.match(id, /^[a-f0-9]{64}$/, 'Invalid benchmark evidence identity');
const json = value => JSON.stringify(value, null, 2) + '\n';
export function benchmarkStore(directory, { savedDirectory = fileURLToPath(new URL('./recordings/', import.meta.url)) } = {}) {
  async function locate(id) {
    validId(id);
    for (const root of [directory, savedDirectory]) {
      try { await readFile(join(root, id, 'journal.json')); return join(root, id); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const error = Error('Benchmark not found'); error.code = 'ENOENT'; throw error;
  }
  return {
    async create(definition) {
      validId(definition.id);
      await mkdir(directory, { recursive: true });
      const root = join(directory, definition.id); await mkdir(root, { recursive: false });
      const campaign = { schemaVersion: 1, id: definition.id, definition, status: 'prepared', attempts: [], interventions: [], events: [], updatedAt: definition.createdAt };
      await writeFile(join(root, 'definition.json'), json(definition), { flag: 'wx' });
      await this.write(campaign); return campaign;
    },
    async write(campaign) {
      validId(campaign.id);
      const { integritySha256, summary, ...body } = campaign;
      body.updatedAt = new Date().toISOString(); body.summary = campaignMetrics(body);
      const path = join(directory, campaign.id, 'journal.json'), temporary = path + '.' + randomUUID() + '.tmp';
      const sealed = { ...body, integritySha256: digest(JSON.stringify(body)) };
      await writeFile(temporary, json(sealed), { mode: 0o600 }); await rename(temporary, path);
      return sealed;
    },
    async read(id) {
      const root = await locate(id), { integritySha256, ...campaign } = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
      assert.equal(digest(JSON.stringify(campaign)), integritySha256, 'Benchmark journal integrity mismatch');
      const definition = JSON.parse(await readFile(join(root, 'definition.json'), 'utf8'));
      const { sha256, ...identity } = definition;
      assert.equal(digest(JSON.stringify(identity)), sha256, 'Benchmark definition identity mismatch');
      assert.deepEqual(campaign.definition, definition);
      assert.equal(campaign.id, id);
      for (const attempt of campaign.attempts) assert.equal(digest(JSON.stringify(attempt.request)), attempt.requestSha256, 'Benchmark request identity mismatch');
      assert.deepEqual(campaign.summary, campaignMetrics(campaign), 'Benchmark measurements changed');
      return { ...campaign, integritySha256 };
    },
    async list() {
      const ids = new Set();
      for (const root of [directory, savedDirectory]) {
        try { for (const id of await readdir(root)) if (/^[a-f0-9-]{36}$/.test(id)) ids.add(id); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const campaigns = await Promise.all([...ids].map(id => this.read(id)));
      return campaigns.sort((a, b) => b.definition.createdAt.localeCompare(a.definition.createdAt));
    },
    async saveEvidence(campaignId, value) {
      validId(campaignId); const encoded = JSON.stringify(value), sha256 = digest(encoded);
      const root = join(directory, campaignId, 'evidence'); await mkdir(root, { recursive: true });
      try { await writeFile(join(root, sha256 + '.json'), encoded, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(join(root, sha256 + '.json'), 'utf8'), encoded); }
      return { sha256, bytes: Buffer.byteLength(encoded) };
    },
    async evidence(campaignId, sha256) {
      validHash(sha256); const root = await locate(campaignId), bytes = await readFile(join(root, 'evidence', sha256 + '.json'));
      assert.equal(digest(bytes), sha256, 'Benchmark evidence integrity mismatch'); return JSON.parse(bytes);
    },
    async lock(id) {
      validId(id); const path = join(directory, id, '.runner-lock');
      try { await mkdir(path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pid = Number(await readFile(join(path, 'pid'), 'utf8'));
        assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid benchmark lock');
        try { process.kill(pid, 0); throw Error('Another runner owns this benchmark'); }
        catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
        await rm(path, { recursive: true }); await mkdir(path);
      }
      await writeFile(join(path, 'pid'), String(process.pid));
      return () => rm(path, { recursive: true });
    },
  };
}
