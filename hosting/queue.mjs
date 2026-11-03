import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GLOBAL_ACTIVE_LIMIT, SESSION_JOB_LIMIT } from './constants.mjs';

const TERMINAL = new Set(['ready', 'failed', 'unsupported', 'cancelled', 'unsuccessful']);

async function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}

/** Durable remix jobs. A restart fails anything that was still running and does not start it again. */
export async function createJobQueue(directory, {
  sessionJobLimit = SESSION_JOB_LIMIT, globalActiveLimit = GLOBAL_ACTIVE_LIMIT,
} = {}) {
  const root = join(directory, 'jobs');
  await mkdir(root, { recursive: true });
  const jobs = new Map();
  async function save(job) {
    jobs.set(job.id, job);
    await atomicWrite(join(root, `${job.id}.json`), JSON.stringify(job));
    return job;
  }
  for (const name of (await readdir(root)).filter(entry => entry.endsWith('.json'))) {
    const job = JSON.parse(await readFile(join(root, name), 'utf8'));
    if (!job?.id || !Array.isArray(job.events)) throw Error('Remix job journal is invalid');
    if (!TERMINAL.has(job.status)) {
      job.status = 'failed';
      job.error = 'Server restarted before completion. Parent unchanged.';
      job.finishedAt = new Date().toISOString();
      job.events.push({ status: 'failed', at: job.finishedAt });
      await atomicWrite(join(root, name), JSON.stringify(job));
    }
    jobs.set(job.id, job);
  }
  const list = () => [...jobs.values()];
  return {
    sessionJobLimit, globalActiveLimit,
    get: id => jobs.get(id) ?? null,
    list,
    save,
    findIdempotent(key) { return list().find(job => job.idempotencyKey === key) ?? null; },
    sessionCount(sessionId) { return list().filter(job => job.sessionId === sessionId).length; },
    activeCount() { return list().filter(job => !TERMINAL.has(job.status)).length; },
    async close() {},
  };
}
