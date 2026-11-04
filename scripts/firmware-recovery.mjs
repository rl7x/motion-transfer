import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { FIRMWARE_PROTOCOL } from '../src/firmware/session.mjs';
import { workingBudgetSnapshot } from './wonder-harness-v6.mjs';

/*
 * Runs the one frozen firmware session through the authoritative cloud ledger.
 * A started session is never sent again, and its result is recorded whatever it is.
 */
const USAGE = `node scripts/firmware-recovery.mjs <command> --deployment-root <main checkout>

  status             Read the ledger and the backend's packages. Spends nothing
  preflight          Send the exact first request to the free token-count endpoint. Generates nothing
  plan               Freeze assets/benchmark/firmware-recovery/plan.json. Spends nothing
  run --allow-paid   Run the one planned session and save its exact report. This spends Meta credits`;
const target = 'assets/benchmark/firmware-recovery', LEDGER = '/app/reports/motion-transfer-phase';
// Session 1 is frozen in plan.json under firmware-recovery-v1, at commit 233661e. It failed and stays on the record.
const PLAN = 'plan-2.json', V6_RESERVE = 2.5;
const SINCE = '2026-11-04T05:00:00Z', CUTOFF = '2026-11-04T21:00:00Z', ceiling = FIRMWARE_PROTOCOL.limits.maxCostUsd;
const FROZEN = ['src/firmware/session.mjs', 'src/firmware/state-space.mjs', 'src/firmware/verify.mjs', 'src/firmware/verify-worker.mjs',
  'src/evaluator/exhaustive-candidate.mjs', 'src/component/build.mjs', 'src/agent/accounting.mjs', 'src/agent/meta-client.mjs',
  'src/campaign/phase-budget.mjs', 'assets/targets/px4-arming/arming.wasm', 'assets/targets/px4-arming/target.lock.json'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'allow-paid': { type: 'boolean' }, 'deployment-root': { type: 'string', default: '.' }, help: { type: 'boolean' } } });
const [command] = positionals;
if (values.help || !command) { console.log(USAGE); process.exit(0); }

async function backend() {
  loadEnvFile(join(values['deployment-root'], '.env.local'));
  const { Sandbox } = await import('../src/hosting/vercel/sdk.mjs');
  const { name } = JSON.parse(await readFile(join(values['deployment-root'], 'reports/vercel-deployment/backend-state.json'), 'utf8'));
  return Sandbox.get({ name, resume: true });
}
const shell = async (sandbox, command, options = {}) => {
  const run = await sandbox.runCommand({ cmd: 'sh', args: ['-c', command], cwd: '/app', ...options });
  return { code: run.exitCode, out: (await run.stdout()).trim(), err: (await run.stderr()).trim() };
};
const ledger = async sandbox => workingBudgetSnapshot(await sandbox.readFileToBuffer({ path: LEDGER + '/phase-budget.json' }), SINCE);
function assertAdmissible(budget) {
  assert.equal(budget.uncertain, false, 'An active or uncertain reservation blocks this session');
  assert.ok(budget.remainingUsd >= ceiling && budget.wonderRemainingUsd >= ceiling, 'The working limit and Wonder category must cover the full ceiling');
}

async function status() {
  const sandbox = await backend();
  const packages = await shell(sandbox, 'for p in typescript wabt esbuild; do test -f node_modules/$p/package.json && echo $p; done; node --version');
  console.log('Backend:', packages.out.replaceAll('\n', ' '), `| lifetime ${Math.floor((sandbox.expiresAt.getTime() - Date.now()) / 60_000)} minutes`);
  const { countedReservations, ...budget } = await ledger(sandbox);
  console.log(JSON.stringify({ ...budget, countedReservations: countedReservations.length }, null, 2));
}

async function restoreSource(sandbox, workspace) {
  await sandbox.writeFiles([{ path: '/tmp/firmware-source.tgz', content: execFileSync('git', ['archive', '--format=tar.gz', 'HEAD'], { maxBuffer: 256 * 1024 * 1024 }) }]);
  const restored = await shell(sandbox, `rm -rf ${workspace} && mkdir -p ${workspace} && tar -xzf /tmp/firmware-source.tgz -C ${workspace} && ln -sfn /app/node_modules ${workspace}/node_modules && rm /tmp/firmware-source.tgz`);
  assert.equal(restored.code, 0, restored.err);
}

async function preflight() {
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'src', 'scripts', 'assets/targets/px4-arming'], { encoding: 'utf8' }), '', 'Commit first: the backend receives HEAD');
  const sandbox = await backend(), workspace = '/tmp/firmware-preflight';
  await restoreSource(sandbox, workspace);
  const script = `import {createMetaClient} from './src/agent/meta-client.mjs';import {firmwareRequest,firstHistory} from './src/firmware/session.mjs';import {loadFirmware} from './src/firmware/state-space.mjs';import {verifyFirmwareCandidate} from './src/firmware/verify.mjs';import {readFile} from 'node:fs/promises';
const {bytes}=await loadFirmware(),client=createMetaClient(process.env.MODEL_API_KEY);
const tokens=await client.countInputTokens(firmwareRequest(await firstHistory(bytes)));
const started=Date.now(),result=await verifyFirmwareCandidate(await readFile('tests/fixtures/px4-arming-reference.ts','utf8'));
console.log(JSON.stringify({firstRequestInputTokens:tokens,referenceVerdict:result.verdict,checked:result.checked,verifyMs:Date.now()-started,error:result.error}));`;
  await sandbox.writeFiles([{ path: workspace + '/preflight.mjs', content: Buffer.from(script) }]);
  const result = await shell(sandbox, 'node preflight.mjs', { cwd: workspace });
  await shell(sandbox, `rm -rf ${workspace}`);
  console.log(result.code === 0 ? result.out : 'Preflight failed: ' + result.err.slice(-500));
  assert.equal(result.code, 0);
}

async function plan() {
  assert.ok(!existsSync(join(target, PLAN)), 'The frozen plan already exists');
  const sandbox = await backend(), budget = await ledger(sandbox);
  assertAdmissible(budget);
  assert.ok(budget.remainingUsd - ceiling >= V6_RESERVE - 1e-9, 'This ceiling must leave the full v6 session inside the working limit');
  const sourceHashes = {};
  for (const path of FROZEN) sourceHashes[path] = sha256(await readFile(path));
  const createdAt = new Date().toISOString(), name = 'firmware-recovery-' + createdAt.slice(0, 16).replace(/[:T]/g, '-');
  const { countedReservations, ...observed } = budget;
  await mkdir(target, { recursive: true });
  await writeFile(join(target, PLAN), JSON.stringify({ schemaVersion: 1, name, createdAt, plannedSessions: 1, protocol: FIRMWARE_PROTOCOL,
    previousSession: { plan: 'plan.json', protocol: 'firmware-recovery-v1', status: 'failed', estimatedCostUsd: 0.25494,
      reason: 'The first response used its whole 12,000 token limit reasoning and made no tool call, and the harness ended the session.' },
    success: 'proved', sourceHashes, workspace: '/tmp/' + name, output: '/app/reports/' + name, phaseLedger: LEDGER, startCutoff: CUTOFF,
    budget: { ...observed, observedAt: createdAt, category: 'wonder', ceilingUsd: ceiling,
      accounting: 'Count all Meta reservations since midnight ET on November 4, the same rule as the v6 plan. Settled costs and full holds count. No category is reallocated.' },
    rules: ['One session. A started session is never repeated, whatever it returns.', 'Reserve the full ceiling under the ledger lock, enforcing the $5 working limit.',
      'Success means proved. A cost ceiling, an exhausted allowance or an inconclusive verdict is a failure, and is published as one.', 'No model is told what the binary is.'] }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Frozen ${PLAN} as ${name}. Used $${budget.usedUsd.toFixed(4)} of $5 since midnight ET. Commit the plan before running.`);
}

const runner = `import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createPhaseBudget} from './src/campaign/phase-budget.mjs';
import {createMetaClient} from './src/agent/meta-client.mjs';
import {FIRMWARE_PROTOCOL as P,runFirmwareSession} from './src/firmware/session.mjs';
import {loadFirmware} from './src/firmware/state-space.mjs';
const p=JSON.parse(await readFile('plan.json'));
for(const [path,sha] of Object.entries(p.sourceHashes))if(createHash('sha256').update(await readFile(path)).digest('hex')!==sha)throw Error('Frozen source changed: '+path);
if(JSON.stringify(p.protocol)!==JSON.stringify(P))throw Error('Frozen protocol changed');
if(Date.now()>=Date.parse(p.startCutoff))throw Error('Paid start cutoff reached');
const client=createMetaClient(process.env.MODEL_API_KEY,{requestTimeoutMs:P.limits.requestTimeoutMs}),{bytes}=await loadFirmware();
await mkdir(p.output);
const budget=await createPhaseBudget(p.phaseLedger,{workingLimit:{maxCostUsd:5,since:p.budget.since}});
let latest;
const id='firmware:'+p.name,save=report=>{latest=report;return writeFile(p.output+'/report.json',JSON.stringify(report,null,2)+'\\n');};
await budget.reserve({id,category:p.budget.category,maxCostUsd:p.budget.ceilingUsd,metadata:{plan:p.name,firmwareSha256:p.sourceHashes['assets/targets/px4-arming/arming.wasm']}});
let report;
try{report=await runFirmwareSession({client,bytes,onUpdate:save});}
finally{const seen=report??latest;await budget.settle({id,estimatedCostUsd:seen?.estimatedCostUsd??0,uncertain:(seen?.reservedCostUsd??0)>0});}
await save(report);
console.log(JSON.stringify({status:report.status,cost:report.estimatedCostUsd,attempts:report.attempts.map(a=>a.result.verdict),error:report.error}));
`;

async function run() {
  assert.ok(values['allow-paid'], 'Pass --allow-paid to spend through the authoritative ledger');
  const frozen = JSON.parse(await readFile(join(target, PLAN), 'utf8'));
  assert.deepEqual(frozen.protocol, JSON.parse(JSON.stringify(FIRMWARE_PROTOCOL)), 'The protocol changed after freezing');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'src', 'scripts', 'assets/targets/px4-arming', target, 'package-lock.json'], { encoding: 'utf8' }), '', 'Commit everything before a paid run');
  assert.ok(Date.now() < Date.parse(frozen.startCutoff), 'No paid session may start after the frozen cutoff');
  const sandbox = await backend();
  assert.ok(sandbox.expiresAt.getTime() - Date.now() > 12 * 60_000, 'The backend needs at least 12 minutes of life');
  assert.notEqual((await shell(sandbox, `test -e ${frozen.output}`)).code, 0, 'This session already started; a started session is never repeated');
  const running = await shell(sandbox, 'ps -eo command | grep -E "recovery|run-[0-9]\\.mjs|firmware" | grep -v grep | wc -l');
  assert.equal(running.out, '0', 'Another paid job is running');
  assertAdmissible(await ledger(sandbox));
  await restoreSource(sandbox, frozen.workspace);
  await sandbox.writeFiles([{ path: frozen.workspace + '/plan.json', content: await readFile(join(target, PLAN)) },
    { path: frozen.workspace + '/run-firmware.mjs', content: Buffer.from(runner) }]);
  const stem = '/tmp/' + frozen.name;
  await sandbox.runCommand({ cmd: 'sh', args: ['-c', `rm -f ${stem}.exit; node run-firmware.mjs > ${stem}.log 2>&1; echo $? > ${stem}.exit`], cwd: frozen.workspace, detached: true });
  console.log('Session started.');
  const deadline = Date.now() + 12 * 60_000;
  let exit = '';
  while (exit === '' && Date.now() < deadline) { await wait(10_000); exit = (await shell(sandbox, `cat ${stem}.exit 2>/dev/null`)).out; }
  console.log((await shell(sandbox, `tail -3 ${stem}.log`)).out.slice(-700));
  assert.notEqual(exit, '', 'The session is still running');
  const reportBytes = await sandbox.readFileToBuffer({ path: frozen.output + '/report.json' });
  const report = JSON.parse(reportBytes);
  await writeFile(join(target, 'report-2.json.gz'), gzipSync(reportBytes));
  await writeFile(join(target, 'results-2.json'), JSON.stringify({ schemaVersion: 1, planName: frozen.name, reportSha256: sha256(reportBytes), status: report.status,
    accepted: report.status === 'completed', acceptedAttempt: report.acceptedAttempt ?? null, attempts: report.attempts.map(item => ({ attempt: item.attempt, sourceSha256: item.result.sourceSha256, verdict: item.result.verdict, reason: item.result.reason ?? null, counterexampleLength: item.result.counterexample?.length ?? null })),
    requests: report.requests.length, binaryRuns: report.binaryRuns, truncations: report.truncations, estimatedCostUsd: report.estimatedCostUsd, reservedCostUsd: report.reservedCostUsd, error: report.error ?? null }, null, 2) + '\n');
  console.log(`Session ${report.status}; $${report.estimatedCostUsd.toFixed(4)}; ${report.attempts.length} submissions.`);
}

if (command === 'status') await status();
else if (command === 'preflight') await preflight();
else if (command === 'plan') await plan();
else if (command === 'run') await run();
else throw Error('Unknown command');
