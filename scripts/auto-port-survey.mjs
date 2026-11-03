import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repositoryUrl } from '../src/paths.mjs';
import { DRIVERS, EXCLUDED } from '../src/auto-port/drivers.mjs';
import { VERIFY, snapshot } from '../src/auto-port/verify.mjs';

// Baseline for every frozen driver on the unmodified games. Makes no model request.
const rows = [];
for (const [id, driver] of Object.entries(DRIVERS)) {
  const directory = fileURLToPath(repositoryUrl(`assets/auto-port/games/${id}`));
  const row = { id };
  try {
    const api = await driver.load(directory);
    const a = driver.session(api, VERIFY.seeds[0]), b = driver.session(api, VERIFY.seeds[0]);
    let ready = 0, deterministic = true, moved = 0, last = null, bytes = 0;
    const started = Date.now();
    for (let tick = 0; tick < VERIFY.ticks; tick += 1) {
      a.step(a.act()); b.step(b.act());
      const left = snapshot(a.state, driver.skip);
      bytes = left.length;
      if (left !== snapshot(b.state, driver.skip)) { deterministic = false; row.diverged = tick; break; }
      if (driver.ready(a.state)) {
        ready += 1;
        const here = driver.position(a.state);
        if (last) moved = Math.max(moved, driver.distance(api, here, last));
        last = here;
      }
    }
    Object.assign(row, { deterministic, ready, moved: Number(moved.toFixed(3)), stateKB: Math.round(bytes / 1024), ms: Date.now() - started });
    const heading = driver.session(api, VERIFY.seeds[0]);
    let held = 0, steps = 0;
    while (steps < 1200 && held < VERIFY.settleTicks) { heading.step(heading.heading); held = driver.ready(heading.state) ? held + 1 : 0; steps += 1; }
    row.settled = held >= VERIFY.settleTicks ? steps : 'never';
    row.tests = driver.tests.map(file => {
      const run = spawnSync(process.execPath, [file], { cwd: directory, timeout: VERIFY.testTimeoutMs, encoding: 'utf8' });
      return `${file}:${run.status}`;
    }).join(' ');
  } catch (error) { row.error = String(error?.stack ?? error).slice(0, 300); }
  rows.push(row);
}
for (const row of rows) console.log(JSON.stringify(row));
console.log(JSON.stringify({ excluded: Object.keys(EXCLUDED) }));
