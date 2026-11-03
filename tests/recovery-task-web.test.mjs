import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLabService } from '../src/lab/service.mjs';
import { createPakuBrowser } from '../src/evaluator/browser-harness.mjs';
import { acceptedRecoveryFixture } from './helpers/recovery-fixture.mjs';
import { reveal } from './helpers/app-navigation.mjs';

test('the saved Meta attempt shows its real contrast and incomplete recovery without a paid request', async () => {
  const harness = await createPakuBrowser();
  try {
    const { page, errors } = await harness.page(), posts = [];
    page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
    await page.goto(harness.origin + '/?destination=jujump');
    await reveal(page, '.recorded-recovery');
    await page.locator('.recorded-recovery').filter({ hasText: 'Meta recovery attempt' }).click();
    await page.waitForFunction(() => document.querySelector('#recovery-task-status')?.textContent.includes('RECOVERY INCOMPLETE'));
    assert.equal(await page.locator('#lab-mode').textContent(), 'SAVED RECORDING');
    assert.match(await page.locator('#recovery-task-measurements').textContent(), /16 model requests/);
    assert.equal(await page.locator('#recovery-download').count(), 0);
    assert.equal(await page.locator('#recovery-play').count(), 0);
    assert.match(await page.locator('#investigation-conclusion').textContent(), /No component candidate submitted/);
    assert.equal(await page.locator('#investigation-report').getAttribute('href'), '/api/investigations/saved/recovery-handoff');
    await page.locator('.recorded-recovery').filter({ hasText: 'Stage-guided recovery' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.recovery-development article').length === 3);
    const development = await page.locator('.recovery-development').textContent();
    assert.match(development, /10 of 13 development checks passed/);
    assert.match(development, /Compiled donor/);
    assert.match(development, /This candidate/);
    assert.match(development, /startup-held · update 10/);
    assert.equal(await page.locator('#recovery-download').count(), 0);
    assert.deepEqual(posts, []); assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});

test('the developer task publishes only the new checked project and reconnects without duplicate generation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-task-ui-'));
  const report = await acceptedRecoveryFixture(directory);
  let modelRuns = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const lab = await createLabService({ directory, client: {}, investigateRun: async ({ requirements, onUpdate }) => {
    modelRuns++; assert.equal(requirements.followupDecision, true);
    await onUpdate(report); await gate; return report;
  } });
  const harness = await createPakuBrowser({ lab });
  try {
    const { page, errors } = await harness.page();
    await page.goto(harness.origin + '/?destination=jujump');
    await reveal(page, '#recover-project');
    await page.waitForFunction(() => !document.querySelector('#recover-project').disabled);
    assert.equal(modelRuns, 0); assert.equal(await page.locator('#recovery-download').count(), 0);
    await page.locator('#recover-project').click();
    await page.waitForFunction(() => document.querySelector('#recovery-task-status')?.textContent.includes('LOCAL VERIFICATION'));
    assert.equal(await page.locator('#recovery-download').count(), 0);
    await page.reload();
    await reveal(page, '#recover-project');
    await page.waitForFunction(() => document.querySelector('#recovery-task-status')?.textContent.includes('LOCAL VERIFICATION'));
    release();
    await page.waitForFunction(() => document.querySelector('#recovery-task-status')?.textContent.includes('CHECKED PROJECT READY'), {}, { timeout: 60000 });
    assert.equal(modelRuns, 1);
    assert.match(await page.locator('.recovery-development').textContent(), /Candidate 1 · Development passed/);
    const development = report.session.recovery.attempts[0].development;
    assert.match(await page.locator('.recovery-development').textContent(), new RegExp(`${development.results.length} of ${development.results.length} development checks passed`));
    assert.match(await page.locator('#recovery-task-measurements').textContent(), /0 model requests/);
    const download = await page.locator('#recovery-download').getAttribute('href');
    const archive = await fetch(harness.origin + download);
    assert.equal(archive.status, 200); assert.ok((await archive.arrayBuffer()).byteLength > 100000);
    const play = await page.locator('#recovery-play').getAttribute('href');
    const redirect = await fetch(harness.origin + play, { redirect: 'manual' });
    assert.equal(redirect.status, 303);
    const standalone = new URL(redirect.headers.get('location'));
    assert.notEqual(standalone.origin, harness.origin);
    const receipt = await (await fetch(harness.origin + download.replace('project.zip', 'validation.json'))).json();
    assert.equal(receipt.passed, true); assert.equal(receipt.candidateId, report.session.recovery.frozenCandidateId);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
  } finally { release(); await harness.close(); await lab.close(); await rm(directory, { recursive: true, force: true }); }
});

test('accepted recovery with a failed recipient check exposes no project download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-task-failure-'));
  const report = await acceptedRecoveryFixture(directory);
  const lab = await createLabService({ directory, client: {}, investigateRun: async () => report,
    integrateRecovery: async () => { throw Error('Injected incompatible recipient configuration'); } });
  const harness = await createPakuBrowser({ lab });
  try {
    const { page } = await harness.page(); await page.goto(harness.origin + '/?destination=jujump');
    await reveal(page, '#recover-project');
    await page.waitForFunction(() => !document.querySelector('#recover-project').disabled);
    await page.locator('#recover-project').click();
    await page.waitForFunction(() => document.querySelector('#recovery-task-status')?.textContent.includes('INTEGRATION NOT VERIFIED'));
    assert.equal(await page.locator('#recovery-download').count(), 0);
    assert.equal(await page.locator('#recovery-play').count(), 0);
    assert.match(await page.locator('#recovery-task').textContent(), /Injected incompatible recipient configuration/);
    assert.equal(lab.status().budget.spentUsd, 0);
  } finally { await harness.close(); await lab.close(); await rm(directory, { recursive: true, force: true }); }
});
