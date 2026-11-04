import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

/*
 * Runs and records one frozen Wonder harness plan through the authoritative cloud ledger.
 * A started session is never sent again, and every planned session ends up in results.json.
 */
const USAGE = `node scripts/wonder-harness.mjs <command> --version v5

  status                            Show each session and the backend's remaining lifetime
  run --trial <n> --allow-paid      Run one fresh session, then collect it. This spends Meta credits
  collect --trial <n>               Save a finished session's exact report under assets/benchmark
  finalize [--reason <text>]        Write results.json. Sessions that never started need a reason

Run needs the backend credentials in .env.local. Finalize makes no model or backend request.`;

const MINIMUM_LIFETIME_MS = 16 * 60 * 1000, SESSION_LIMIT_MS = 15 * 60 * 1000;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  version: { type: 'string', default: 'v5' }, trial: { type: 'string' }, reason: { type: 'string' }, 'allow-paid': { type: 'boolean' }, help: { type: 'boolean' },
} });
const [command] = positionals;
if (values.help || !command) { console.log(USAGE); process.exit(0); }

const target = `assets/benchmark/wonder-harness-${values.version}`, local = `reports/wonder-harness-${values.version}`;
const plan = JSON.parse(await readFile(join(target, 'plan.json'), 'utf8'));
const ordinal = Number(values.trial);
const requireTrial = () => assert.ok(Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= plan.plannedTrials, `Pass --trial 1 to ${plan.plannedTrials}`);

async function backend() {
  loadEnvFile('.env.local');
  const { Sandbox } = await import('../src/hosting/vercel/sdk.mjs');
  const { name } = JSON.parse(await readFile('reports/vercel-deployment/backend-state.json', 'utf8'));
  return { Sandbox, name, sandbox: await Sandbox.get({ name, resume: true }) };
}

const shell = async (sandbox, command, options = {}) => {
  const run = await sandbox.runCommand({ cmd: 'sh', args: ['-c', command], cwd: '/app', ...options });
  return { code: run.exitCode, out: (await run.stdout()).trim(), err: (await run.stderr()).trim() };
};

/** A session must be able to finish, so a short-lived backend is restarted before one begins. */
async function withLifetime() {
  const { Sandbox, name, sandbox } = await backend();
  if (sandbox.expiresAt.getTime() - Date.now() > MINIMUM_LIFETIME_MS) return sandbox;
  const running = await shell(sandbox, 'ps -eo command | grep -E "recovery|run-[0-9]\\.mjs" | grep -v grep | wc -l');
  assert.equal(running.out, '0', 'A session is still running; let it finish first');
  await sandbox.stop();
  const fresh = await Sandbox.get({ name, resume: true });
  assert.ok(fresh.expiresAt.getTime() - Date.now() > MINIMUM_LIFETIME_MS, 'The backend needs at least 16 minutes before a session');
  return fresh;
}

/** The frozen source lives in /tmp, which a restart can clear, so restore it from the hashed archive. */
async function frozenWorkspace(sandbox) {
  if ((await shell(sandbox, `test -f ${plan.workspace}/src/agent/recovery-protocol.mjs`)).code !== 0) {
    const archive = await readFile(join(local, 'source.tgz'));
    assert.equal(sha256(archive), plan.sourceArchiveSha256, 'The source archive does not match the frozen plan');
    await sandbox.writeFiles([{ path: '/tmp/harness-source.tgz', content: archive },
      { path: `${plan.workspace}/plan.json`, content: await readFile(join(target, 'plan.json')) }]);
    const restored = await shell(sandbox, `mkdir -p ${plan.workspace} && tar -xzf /tmp/harness-source.tgz -C ${plan.workspace} && ln -sfn /app/node_modules ${plan.workspace}/node_modules && rm /tmp/harness-source.tgz`);
    assert.equal(restored.code, 0, restored.err);
  }
  const check = `import {snapshotRecoveryProtocol as s} from './src/agent/recovery-protocol.mjs';console.log((await s({model:'${plan.model}'})).id)`;
  const identity = await shell(sandbox, `node --input-type=module -e "${check}"`, { cwd: plan.workspace });
  assert.equal(identity.out, plan.protocol.id, `The workspace no longer matches the frozen protocol. ${identity.err.slice(-200)}`);
}

const runner = trial => `import assert from 'node:assert/strict';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {createPhaseBudget} from './src/campaign/phase-budget.mjs';
import {runRecoveryCampaign} from './src/campaign/recovery-runner.mjs';
const p=JSON.parse(await readFile('plan.json')),trial=${trial};
let started=false;try{await stat(p.output+'/trial-'+trial);started=true;}catch(e){if(e.code!=='ENOENT')throw e;}
assert.equal(started,false,'A started trial cannot run again');
if(trial>1)assert.equal(JSON.parse(await readFile(p.output+'/trial-'+(trial-1)+'/journal.json')).status,'completed');
const budget=await createPhaseBudget(p.phaseLedger);
const r=await runRecoveryCampaign({directory:p.output+'/trial-'+trial,phaseBudget:budget,development:true,model:p.model,protocolName:p.protocol.name,maxCostUsd:p.protocol.limits.maxCostUsd,apiKey:process.env.MODEL_API_KEY,onProgress:console.log});
console.log(JSON.stringify({trial,summary:r.summary,error:r.trials[0].error}));
await writeFile(p.output+'/finished-'+trial+'.json',JSON.stringify({at:new Date().toISOString(),budget:await budget.status()}));
`;

async function collect(sandbox, trialNumber) {
  const archive = `/tmp/${plan.name}-${trialNumber}.tgz`;
  const packed = await sandbox.runCommand({ cmd: 'tar', args: ['-czf', archive, '-C', plan.output, `trial-${trialNumber}`], cwd: '/app' });
  assert.equal(packed.exitCode, 0, 'That session has no results on the backend');
  await mkdir(join(local, 'complete'), { recursive: true });
  const saved = join(local, `trial-${trialNumber}.tgz`);
  await writeFile(saved, await sandbox.readFileToBuffer({ path: archive }));
  execFileSync('tar', ['-xzf', saved, '-C', join(local, 'complete')]);
  const root = join(local, 'complete', `trial-${trialNumber}`);
  const journal = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
  assert.equal(journal.status, 'completed', 'That session has not finished');
  const trial = journal.trials[0], { report } = trial, reportFile = `report-${trialNumber}.json.gz`;
  await writeFile(join(target, reportFile), gzipSync(await readFile(join(root, trial.reportRef.path))));
  const result = { ordinal: trialNumber, status: trial.status, failureCategory: trial.failureCategory ?? null, error: trial.error ?? null,
    sessionId: report.session.id, campaignId: journal.definition.id, reportFile, reportSha256: trial.reportRef.sha256,
    requests: report.requests.length, estimatedCostUsd: report.estimatedCostUsd, reservedCostUsd: report.reservedCostUsd, elapsedMs: trial.elapsedMachineMs,
    attempts: report.session.recovery.attempts.map(attempt => ({ candidateId: attempt.candidateId,
      developmentPassed: attempt.development.results?.filter(result => result.passed).length ?? 0,
      acceptancePassed: attempt.acceptance?.results?.filter(result => result.passed).length ?? null })),
    integration: trial.integration ?? null };
  if (trial.integration) {
    const bytes = await readFile(join(root, 'integrations', trial.integration.id, 'validation.json'));
    result.verificationFile = `verification-${trialNumber}.json`;
    result.verificationSha256 = sha256(bytes);
    await writeFile(join(target, result.verificationFile), bytes);
  }
  await writeFile(join(local, `result-${trialNumber}.json`), JSON.stringify(result, null, 2) + '\n');
  const best = result.attempts.at(-1);
  const scores = best ? `development ${best.developmentPassed}/${plan.protocol.development.caseCount}; acceptance ${best.acceptancePassed ?? 'not reached'}` : 'no candidate';
  console.log(`Session ${trialNumber}: ${result.status}; ${scores}; $${result.estimatedCostUsd.toFixed(4)}`);
}

async function run() {
  requireTrial();
  assert.ok(values['allow-paid'], 'Pass --allow-paid to spend through the authoritative ledger');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', join(target, 'plan.json')], { encoding: 'utf8' }), '', 'Commit the frozen plan first');
  const sandbox = await withLifetime();
  await frozenWorkspace(sandbox);
  assert.notEqual((await shell(sandbox, `test -e ${plan.output}/trial-${ordinal}`)).code, 0, `Session ${ordinal} already started; a started session is never repeated`);
  const stem = `/tmp/${plan.name}-${ordinal}`;
  await sandbox.writeFiles([{ path: `${plan.workspace}/run-${ordinal}.mjs`, content: Buffer.from(runner(ordinal)) }]);
  await sandbox.runCommand({ cmd: 'sh', args: ['-c', `rm -f ${stem}.exit; node run-${ordinal}.mjs > ${stem}.log 2>&1; echo $? > ${stem}.exit`],
    cwd: plan.workspace, env: { BROWSER_CHANNEL: 'chromium' }, detached: true });
  console.log(`Session ${ordinal} started; backend expires ${sandbox.expiresAt.toISOString()}`);
  const deadline = Date.now() + SESSION_LIMIT_MS;
  let exit = '';
  while (exit === '' && Date.now() < deadline) {
    await wait(15_000);
    exit = (await shell(sandbox, `cat ${stem}.exit 2>/dev/null`)).out;
  }
  assert.notEqual(exit, '', `Session ${ordinal} is still running; collect it once it finishes`);
  console.log((await shell(sandbox, `tail -2 ${stem}.log`)).out.slice(-400));
  assert.equal(exit, '0', `Session ${ordinal} could not finish cleanly; its ledger entry must be checked first`);
  await collect(sandbox, ordinal);
}

async function status() {
  const { sandbox } = await backend();
  const script = `import {readFile} from 'node:fs/promises';for(let n=1;n<=${plan.plannedTrials};n+=1){try{const j=JSON.parse(await readFile('${plan.output}/trial-'+n+'/journal.json')),t=j.trials[0],r=t.report;console.log(n,j.status,t.status,r?.requests.length,r?.estimatedCostUsd);}catch(e){if(e.code==='ENOENT')console.log(n,'not started');else throw e;}}`;
  console.log((await shell(sandbox, `node --input-type=module -e "${script}"`)).out);
  console.log(`Backend lifetime remaining: ${Math.floor((sandbox.expiresAt.getTime() - Date.now()) / 60_000)} minutes`);
}

/** Every planned session is reported. One that never started needs a stated reason. */
async function finalize() {
  const trials = [];
  for (let trial = 1; trial <= plan.plannedTrials; trial += 1) {
    const path = join(local, `result-${trial}.json`);
    if (existsSync(path)) trials.push(JSON.parse(await readFile(path, 'utf8')));
    else {
      assert.ok(values.reason, `Session ${trial} never started; pass --reason`);
      trials.push({ ordinal: trial, status: 'not-run', reason: values.reason, requests: 0, estimatedCostUsd: 0 });
    }
  }
  const required = plan.protocol.acceptance.caseCount;
  const accepted = trials.filter(trial => trial.attempts?.some(attempt => attempt.acceptancePassed === required)).length;
  const results = { schemaVersion: 1, protocolId: plan.protocol.id, accepted, interrupted: trials.filter(trial => trial.status === 'interrupted').length,
    estimatedCostUsd: trials.reduce((sum, trial) => sum + trial.estimatedCostUsd, 0), trials };
  await writeFile(join(target, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`${accepted} of ${trials.filter(trial => trial.status !== 'not-run').length} started sessions accepted; $${results.estimatedCostUsd.toFixed(4)}`);
}

if (command === 'run') await run();
else if (command === 'status') await status();
else if (command === 'finalize') await finalize();
else if (command === 'collect') { requireTrial(); await collect((await backend()).sandbox, ordinal); }
else { console.error(USAGE); process.exit(1); }
