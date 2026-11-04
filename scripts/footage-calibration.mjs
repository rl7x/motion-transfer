import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { createOpenClient, OPEN_MODEL, OPEN_MODEL_NAME, OPEN_PRICE } from '../src/agent/open-client.mjs';
import { freezeFidelityStudy, scoreFidelityStudy } from '../src/benchmark/fidelity.mjs';
import { calibrationSteps, CLIP_SCALE, compareWithTruth, FIRST_PLAY_FRAME, PLAYER_POINT, renderCalibrationClip, trueBursts } from '../src/footage/calibration.mjs';
import { ledgerSam } from '../src/footage/cloud-sam.mjs';
import { recoverMove } from '../src/footage/recover.mjs';

/*
 * Tests recovery from footage on the one game where the true answer is known. The plan is committed
 * before the first request. The model never sees the true positions or the 40-trace exam.
 */
const MANIFEST = 'src/benchmark/footage-tasks.json';
const FROZEN = ['src/footage/calibration.mjs', 'src/footage/clip.mjs', 'src/footage/grade.mjs', 'src/footage/landmarks.mjs', 'src/footage/recover.mjs',
  'src/footage/request.mjs', 'src/footage/sam.mjs', 'src/footage/trajectory.mjs', 'src/agent/open-client.mjs', 'scripts/footage-calibration.mjs'];
const SAVED = { id: 'saved-recovery', condition: 'saved-recovery', sourcePath: 'assets/components/dashy-dango-dash/component.ts', configPath: 'assets/components/dashy-dango-dash/contract.json' };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: { freeze: { type: 'boolean' }, 'allow-paid': { type: 'boolean' }, out: { type: 'string' } } });

async function definition() {
  const sources = {};
  for (const path of FROZEN) sources[path] = digest(await readFile(path));
  return {
    schemaVersion: 1, name: 'footage-calibration-v1',
    question: 'From footage alone, how close can SAM 3.1 and Muse Spark Open get to a move whose true behavior is known?',
    tracker: 'sam-3.1', controllerModel: OPEN_MODEL, maxAttempts: 3, clipSteps: calibrationSteps(), exam: 'the existing 40-trace fidelity comparison, generated after the candidate is frozen',
    disclosed: 'Only tracker measurements of practice bursts. No source, binary, button log, true positions or timing defaults.', sources,
  };
}

if (values.freeze) {
  await writeFile(MANIFEST, JSON.stringify(await definition(), null, 2) + '\n');
  console.log(`Wrote ${MANIFEST}. Commit it before any model request.`);
  process.exit(0);
}
const frozen = JSON.parse(await readFile(MANIFEST, 'utf8'));
assert.deepEqual(await definition(), frozen, 'The code no longer matches the frozen plan');
assert.equal(execFileSync('git', ['status', '--porcelain', '--', MANIFEST, ...FROZEN], { encoding: 'utf8' }), '', 'Commit the frozen plan and its sources first');
assert.ok(values['allow-paid'], 'Pass --allow-paid to spend through the ledger and Baseten');
assert.ok(values.out, 'Pass --out <new directory>');
loadEnvFile('.env');
await mkdir(values.out, { recursive: false });

const { clip, truth } = await renderCalibrationClip(values.out);
const client = createOpenClient(process.env.BASETEN_API_KEY);
const result = await recoverMove({
  clip, out: join(values.out, 'recovered'), rights: 'open-license', source: 'Dashy Dango by samX500 and willGuimont (ISC)',
  player: PLAYER_POINT, pixelScale: CLIP_SCALE, from: FIRST_PLAY_FRAME, sam: await ledgerSam(), model: OPEN_MODEL, modelName: OPEN_MODEL_NAME, log: line => console.log(line),
  generate: async request => {
    const response = await client.respond(request);
    return { response, estimatedCostUsd: tokenCost(readUsage(response.usage), OPEN_PRICE) };
  },
});

const study = join(values.out, 'study');
await freezeFidelityStudy(study, [
  { id: 'from-footage', condition: 'video', sourcePath: join(result.out, 'component.ts'), configPath: join(result.out, 'contract.json') },
  SAVED,
]);
const score = await scoreFidelityStudy(study);
const truthBursts = trueBursts(truth);
const accuracy = compareWithTruth(result.steps, truth);
const evidence = {
  name: frozen.name, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tracker: frozen.tracker, controllerModel: frozen.controllerModel,
  frames: truth.length, tracking: accuracy,
  bursts: { found: result.bursts.length, real: truthBursts.length, foundFrames: result.bursts.map(burst => burst.frames), realFrames: truthBursts.map(burst => burst.frames) },
  controller: { summary: result.submission.summary, config: result.submission.config, source: result.submission.source, attempts: result.report.attempts },
  heldOut: result.report.heldOut, exam: score, estimatedCostUsd: result.report.estimatedCostUsd,
};
await writeFile(join(values.out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ tracking: accuracy, bursts: evidence.bursts, cost: evidence.estimatedCostUsd }, null, 1));
console.log(JSON.stringify(score, null, 1).slice(0, 1200));
