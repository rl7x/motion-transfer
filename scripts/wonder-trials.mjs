import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { snapshotRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';

/*
 * Runs one frozen Wonder trial where the authoritative ledger lives. The backend keeps running it
 * if this process stops, and a started trial is never sent again.
 */
const MANIFEST = 'src/benchmark/wonder-repeat-tasks.json', LEDGER = 'reports/motion-transfer-phase', REMOTE = 'reports/wonder-repeat';
const TRIAL_LIMIT_MS = 16 * 60 * 1000;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const { values } = parseArgs({ options: { trial: { type: 'string' }, out: { type: 'string', default: REMOTE }, 'allow-paid': { type: 'boolean' } } });
const ordinal = Number(values.trial);
const frozen = JSON.parse(await readFile(MANIFEST, 'utf8'));
assert.ok(Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= frozen.plannedTrials, `Pass --trial 1 to ${frozen.plannedTrials}`);
assert.ok(values['allow-paid'], 'Pass --allow-paid to spend through the authoritative ledger');
assert.equal(execFileSync('git', ['status', '--porcelain', '--', MANIFEST], { encoding: 'utf8' }), '', 'Commit the frozen plan first');
assert.equal((await snapshotRecoveryProtocol({ model: frozen.model })).id, frozen.protocolId, 'This checkout no longer matches the frozen protocol');
const local = join(values.out, `trial-${ordinal}`);
assert.ok(!existsSync(local), `Trial ${ordinal} already has results; a started trial is never repeated`);

loadEnvFile('.env.local');
const { Sandbox } = await import('../src/hosting/vercel/sdk.mjs');
const { name } = JSON.parse(await readFile('reports/vercel-deployment/backend-state.json', 'utf8'));
// A fresh session, so the 45-minute Hobby limit cannot end a trial partway through.
await (await Sandbox.get({ name, resume: true })).stop();
const backend = await Sandbox.get({ name, resume: true });
const env = { BROWSER_CHANNEL: 'chromium' };
const shell = async command => {
  const run = await backend.runCommand({ cmd: 'sh', args: ['-c', command], cwd: '/app', env });
  return { code: run.exitCode, out: (await run.stdout()).trim(), err: (await run.stderr()).trim() };
};
const node = code => shell(`node --input-type=module -e "${code}"`);
const started = await shell(`test -e ${REMOTE}/trial-${ordinal}`);
assert.notEqual(started.code, 0, `Trial ${ordinal} already started on the backend`);
assert.equal((await node("console.log(Boolean(process.env.MODEL_API_KEY))")).out, 'true', 'The backend has no model key');
assert.equal((await node(`import {snapshotRecoveryProtocol as s} from './src/agent/recovery-protocol.mjs';console.log((await s({model:'${frozen.model}'})).id)`)).out, frozen.protocolId, 'The backend no longer matches the frozen protocol');
assert.equal((await shell('command -v unzip >/dev/null && echo ready')).out, 'ready', 'The backend cannot publish a recovery');
const budget = JSON.parse((await node(`import {createPhaseBudget as c} from './src/campaign/phase-budget.mjs';const s=await (await c('${LEDGER}')).status();console.log(JSON.stringify({wonder:s.categories.wonder.remainingUsd,uncertain:s.uncertain}))`)).out);
console.log(`Wonder allocation before this trial: $${budget.wonder.toFixed(4)}`);
assert.equal(budget.uncertain, false, 'Unresolved billing blocks new inference');
assert.ok(budget.wonder >= frozen.budget.reservedPerTrialUsd, `Only $${budget.wonder.toFixed(2)} remains, below the $${frozen.budget.reservedPerTrialUsd} reservation`);

const stem = `/tmp/wonder-trial-${ordinal}`;
await backend.runCommand({ cmd: 'sh', cwd: '/app', env, detached: true, args: ['-c',
  `node scripts/recovery-campaign.mjs --development --model ${frozen.model} --out ${REMOTE}/trial-${ordinal} --phase-ledger ${LEDGER} > ${stem}.log 2>&1; echo $? > ${stem}.exit`] });
console.log(`Trial ${ordinal} started on the backend`);
const deadline = Date.now() + TRIAL_LIMIT_MS;
let lines = 0, code = '';
while (Date.now() < deadline && code === '') {
  await wait(15_000);
  const log = (await shell(`cat ${stem}.log 2>/dev/null`)).out.split('\n').filter(Boolean);
  for (const line of log.slice(lines)) console.log(line.slice(0, 200));
  lines = log.length;
  code = (await shell(`cat ${stem}.exit 2>/dev/null`)).out;
}
assert.notEqual(code, '', `Trial ${ordinal} is still running on the backend; check it before doing anything else`);
await shell(`tar -czf ${stem}.tgz -C ${REMOTE} trial-${ordinal}`);
await mkdir(local, { recursive: true });
await writeFile(`${local}.tgz`, await backend.readFileToBuffer({ path: `${stem}.tgz` }));
execFileSync('tar', ['-xzf', `${local}.tgz`, '-C', values.out]);
await backend.stop();
console.log(`Trial ${ordinal} finished with exit ${code}. Results are in ${local}. The ledger is saved.`);
