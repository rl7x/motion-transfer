import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { loadPinnedComponent } from '../hosting/component-load.mjs';
import { ACCEPTED_COMPONENT_ID } from '../hosting/component-pin.mjs';
import { injectRuntime, runPortInBrowser } from './browser.mjs';
import { applyPatches } from './patches.mjs';
import { AUTO_PORT, autoPortRequest, readSubmission, repairFeedback } from './request.mjs';
import { buildRuntime } from './runtime.mjs';

const SKIPPED = new Set(['.git', 'node_modules']);

// A tile platformer showed why: a burst larger than one tile skipped its walls, and every automatic check still passed.
export const PORT_GUIDANCE = 'Before patching, read how this game detects collisions. One tick of the dash can be far faster than normal movement, so collision code that only tests neighbouring cells, or that only looks at the current velocity, will let the avatar pass through walls or leave the map. Walls must stop the dash in every direction and from a standstill. While the dash owns motion, collision on each axis must follow the direction of the dash, not the previous velocity of the avatar, including when the player reverses direction or hits a ceiling mid-dash. Prefer applying the dash through the variables the collision code reads, such as the velocity for that tick. If that code only handles one cell of movement per tick, keep the dash and normal speed together under one cell per tick, or split the movement into smaller steps. Every tick of the dash moves about 7.5 source pixels.';

export const CHECKED = Object.freeze(['Every patch anchor matched exactly once', 'The patches add no forbidden capability', 'The game runs in a real browser with no page errors or outside requests', 'The dash fires from its key']);
export const NOT_CHECKED = Object.freeze(['That your game plays the same when the dash is unused', 'That your game\'s own tests still pass', 'That walls and map edges stop the dash, since fast movement can skip collision checks', 'How far the dash moves, or how it feels']);

function checkInputs(directory, core, out) {
  const root = resolve(directory), file = resolve(root, core);
  if (!existsSync(join(root, 'index.html'))) throw Error(`${directory} has no index.html`);
  if (!file.startsWith(root + sep)) throw Error('--core must be a file inside the game directory');
  if (!existsSync(file)) throw Error(`${core} is not in ${directory}`);
  if (resolve(out) === root) throw Error('--out must not be the game directory; the original stays untouched');
  return { root, core: relative(root, file) };
}

/** Sends a port back to Spark with what a person found when they played it. */
export function revision(previous, note) {
  return repairFeedback(previous, { checks: [{ name: 'developer-playtest', passed: false, error: note }] });
}

/**
 * Ports the recovered dash into one browser game. `generate` makes one paid request and returns
 * { response, estimatedCostUsd }. Generated code only ever runs inside a browser page.
 */
export async function portGame({ directory, core, out = `${resolve(directory)}-dash`, dashKey = 'KeyX', revise = null, generate, log = () => {}, component = null, guidance = '', model = AUTO_PORT.model }) {
  const { root, core: file } = checkInputs(directory, core, out);
  if (existsSync(out) && (await readdir(out)).length > 0) throw Error(`${out} is not empty; choose a new --out`);
  const source = await readFile(join(root, file), 'utf8');
  const move = component ?? await loadPinnedComponent(ACCEPTED_COMPONENT_ID);
  const runtime = await buildRuntime({ component: move, dashKey });
  const work = await mkdtemp(join(tmpdir(), 'motion-port-'));
  const attempts = [];
  try {
    await cp(root, work, { recursive: true, filter: path => !SKIPPED.has(basename(path)) });
    let feedback = revise, detail = null, failure = null;
    for (let attempt = 1; attempt <= AUTO_PORT.maxAttempts && detail === null; attempt += 1) {
      log(`Asking ${model} to connect the dash to ${file} (attempt ${attempt} of ${AUTO_PORT.maxAttempts})`);
      const { response, estimatedCostUsd } = await generate(autoPortRequest({ file, source, feedback: { guidance: [PORT_GUIDANCE, guidance].filter(Boolean).join(' '), ...feedback } }), attempt);
      const record = { attempt, estimatedCostUsd, status: 'no-submission', summary: null, unitsPerSourcePixel: null, patches: [], failure: null };
      attempts.push(record);
      let submission;
      try { submission = readSubmission(response); }
      catch (error) {
        // The request was still billed, so it counts as an attempt and the same request is tried again.
        failure = record.failure = error.message;
        log(`Attempt ${attempt} failed: ${failure}`);
        continue;
      }
      Object.assign(record, { status: submission.status, summary: submission.summary, unitsPerSourcePixel: submission.unitsPerSourcePixel, patches: submission.patches });
      if (submission.status === 'unsupported') throw Error(`${model} declined this game: ${submission.summary}`);
      try {
        await writeFile(join(work, file), applyPatches(source, submission.patches));
        ({ detail } = await runPortInBrowser({ directory: work, runtime, driver: { dashKey } }));
        log(`Browser check passed: ${detail}`);
      } catch (error) {
        failure = record.failure = error.message;
        log(`Attempt ${attempt} failed: ${failure}`);
        feedback = repairFeedback(submission, { checks: [{ name: 'port-check', passed: false, error: failure }] });
      }
    }
    const estimatedCostUsd = attempts.reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0);
    if (detail === null) throw Error(`The port failed after ${attempts.length} attempts ($${estimatedCostUsd.toFixed(4)} estimated): ${failure}`);
    const html = await readFile(join(work, 'index.html'), 'utf8');
    await writeFile(join(work, 'index.html'), injectRuntime(html).replace('/__motion-dash.js', 'motion-dash.js'));
    await writeFile(join(work, 'motion-dash.js'), runtime);
    const report = { model, componentId: move.provenance.id, game: basename(root), core: file, dashKey, status: 'passed', browser: detail, estimatedCostUsd, attempts, checked: CHECKED, notChecked: NOT_CHECKED };
    await writeFile(join(work, 'motion-port.json'), JSON.stringify(report, null, 2) + '\n');
    await cp(work, out, { recursive: true });
    return { ...report, out: resolve(out) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
