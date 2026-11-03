import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { verifySavedMotion } from '../src/evaluator/saved-motion.mjs';

const execute = promisify(execFile);
const directory = fileURLToPath(new URL('../assets/components/dashy-dango-dash/', import.meta.url));

test('saved Meta component reproduces all frozen suites with matching source and evidence hashes', async () => {
  const report = await verifySavedMotion();
  assert.equal(report.cases, 53);
  assert.equal(report.ticks, 6744);
  assert.equal(report.maxPositionError, 0);
  assert.equal(report.metaCalled, false);
});

test('the actual export runs in an empty workspace and modified source cannot retain its verdict', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'recovered-dash-test-'));
  try {
    const offline = join(temporary, 'offline');
    await mkdir(offline);
    for (const name of ['component.js', 'contract.json', 'package.json']) await cp(join(directory, name), join(offline, name));
    const code = `import {readFile} from 'node:fs/promises'; import {init,step} from './component.js';
      const config=JSON.parse(await readFile('contract.json','utf8')).defaults;
      let state=init(config), x=0, tick=0; const events=[];
      for(const [buttons,frames] of [[0,10],[33,1],[0,7]]) for(let i=0;i<frames;i++) {
        const result=step(state,{buttons,sourceBodyWidth:8},config); state=result.state;
        x+=result.output.displacement.x; tick++; for(const event of result.output.events) events.push([tick,event]);
      }
      console.log(JSON.stringify({x,events}));`;
    const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', code], { cwd: offline, env: { PATH: process.env.PATH ?? '' } });
    assert.deepEqual(JSON.parse(stdout), { x: 60, events: [[11, 'dash-start'], [18, 'dash-end']] });
    assert.deepEqual((await readdir(offline)).sort(), ['component.js', 'contract.json', 'package.json']);
    const changed = join(temporary, 'changed');
    await cp(directory, changed, { recursive: true });
    await appendFile(join(changed, 'component.ts'), '\n// changed after evaluation\n');
    await assert.rejects(verifySavedMotion(changed), /Saved source hash mismatch/);
    const provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
    assert.deepEqual(provenance.models, ['muse-wonder-1.0', 'muse-spark-1.3']);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
