import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { digest } from '../component/build.mjs';
import { acceptanceCases } from '../evaluator/cases.mjs';
import { evaluateMotion } from '../evaluator/motion.mjs';

const CONDITIONS = new Set(['saved-recovery', 'fresh-recovery', 'video', 'contact-sheet', 'by-feel', 'author-baseline']);
const evaluatorFiles = ['evaluator/motion.mjs', 'evaluator/cases.mjs', 'evaluator/dashy-dango.mjs', 'component/build.mjs', 'component/run.mjs', 'component/worker.mjs', 'package-lock.json', 'targets/dashy-dango/cart.wasm'];
const root = new URL('../', import.meta.url);
const json = value => JSON.stringify(value, null, 2) + '\n';
const hashObject = value => digest(JSON.stringify(value));

async function evaluatorIdentity() {
  const files = {};
  for (const path of evaluatorFiles) files[path] = digest(await readFile(new URL(path, root)));
  return files;
}

// All supplied candidates are copied and frozen before the study seed exists.
// This is a separate comparison suite, never a recovery acceptance decision.
export async function freezeFidelityStudy(directory, candidates) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 20) throw new Error('Supply 1–20 predeclared candidates');
  const ids = new Set();
  const snapshots = [];
  for (const candidate of candidates) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate.id ?? '') || ids.has(candidate.id)) throw new Error('Candidate IDs must be unique lowercase slugs');
    if (!CONDITIONS.has(candidate.condition)) throw new Error('Unknown fidelity condition');
    if (typeof candidate.sourcePath !== 'string' || typeof candidate.configPath !== 'string') throw new Error('Each candidate needs sourcePath and configPath');
    const source = await readFile(candidate.sourcePath, 'utf8');
    const configFile = JSON.parse(await readFile(candidate.configPath, 'utf8'));
    const config = configFile.defaults ?? configFile;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Candidate config must be an object or a contract with defaults');
    const configText = json(config);
    snapshots.push({ id: candidate.id, condition: candidate.condition, source, configText });
    ids.add(candidate.id);
  }
  const evaluator = await evaluatorIdentity();
  await mkdir(directory, { recursive: false });
  const entries = [];
  for (const snapshot of snapshots) {
    const sourceFile = `${snapshot.id}.ts`, configFile = `${snapshot.id}.config.json`;
    await writeFile(join(directory, sourceFile), snapshot.source, { flag: 'wx' });
    await writeFile(join(directory, configFile), snapshot.configText, { flag: 'wx' });
    entries.push({ id: snapshot.id, condition: snapshot.condition, sourceFile, configFile,
      sourceSha256: digest(snapshot.source), configSha256: digest(snapshot.configText) });
  }
  const contents = { schemaVersion: 1, kind: 'frozen-fidelity-study', createdAt: new Date().toISOString(),
    seed: randomBytes(4).readUInt32LE(), traceCount: 40, evaluator, candidates: entries,
    scoring: 'position within 0.25 source pixels; exact ownership and output events; no internal timer scoring',
    scope: 'Finite comparison against the donor, not recovery acceptance or a productivity estimate. Do not repair candidates after observing this suite.' };
  const manifest = { ...contents, id: hashObject(contents) };
  await writeFile(join(directory, 'study.json'), json(manifest), { flag: 'wx' });
  return manifest;
}

export async function scoreFidelityStudy(directory) {
  const { id, ...manifest } = JSON.parse(await readFile(join(directory, 'study.json'), 'utf8'));
  if (hashObject(manifest) !== id || manifest.kind !== 'frozen-fidelity-study' || manifest.schemaVersion !== 1
    || manifest.traceCount !== 40 || !Number.isSafeInteger(manifest.seed) || manifest.seed < 0 || manifest.seed > 0xffffffff) throw new Error('Fidelity manifest integrity mismatch');
  if (hashObject(await evaluatorIdentity()) !== hashObject(manifest.evaluator)) throw new Error('Evaluator changed since the study froze');
  const snapshots = [];
  const ids = new Set();
  for (const entry of manifest.candidates) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id) || !CONDITIONS.has(entry.condition)
      || entry.sourceFile !== `${entry.id}.ts` || entry.configFile !== `${entry.id}.config.json`) throw new Error('Invalid frozen candidate entry');
    ids.add(entry.id);
    const source = await readFile(join(directory, entry.sourceFile), 'utf8');
    const configText = await readFile(join(directory, entry.configFile), 'utf8');
    if (digest(source) !== entry.sourceSha256 || digest(configText) !== entry.configSha256) throw new Error('Frozen candidate changed; refusing held-out scoring');
    snapshots.push({ entry, source, config: JSON.parse(configText) });
  }
  // Exclusive result creation prevents a later run from replacing an outcome.
  const output = join(directory, 'results.json');
  await writeFile(output, json({ schemaVersion: 1, studyId: id, status: 'running', metaCalled: false }), { flag: 'wx' });
  const results = [];
  for (const { entry, source, config } of snapshots) {
    try {
      // Respect the existing worker's 32-trace bound without weakening it.
      const cases = acceptanceCases(manifest.seed, manifest.traceCount);
      const batches = [];
      for (let offset = 0; offset < cases.length; offset += 20) batches.push(await evaluateMotion(source, config, cases.slice(offset, offset + 20), { suite: 'fidelity-comparison' }));
      const evaluation = { ...batches[0], passed: batches.every(batch => batch.passed), results: batches.flatMap(batch => batch.results) };
      results.push({ ...entry, status: 'scored', passed: evaluation.results.filter(trace => trace.passed).length,
        total: manifest.traceCount, maxPositionError: Math.max(...evaluation.results.map(trace => trace.maxPositionError)), evaluation });
    } catch (error) {
      results.push({ ...entry, status: 'failed', passed: 0, total: manifest.traceCount, error: error.message });
    }
  }
  const report = { schemaVersion: 1, studyId: id, status: 'complete', seed: manifest.seed,
    metaCalled: false, scoring: manifest.scoring, scope: manifest.scope, results };
  await writeFile(output, json(report));
  return report;
}

export function resolveCandidatePaths(candidates, base) {
  if (!Array.isArray(candidates)) throw new Error('Input must contain a candidates array');
  return candidates.map(candidate => ({ ...candidate,
    sourcePath: resolve(base, candidate.sourcePath), configPath: resolve(base, candidate.configPath) }));
}
