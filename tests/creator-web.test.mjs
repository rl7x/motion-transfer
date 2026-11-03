import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import { chromium } from 'playwright';
import { buildCreatorPage } from '../scripts/build-creator.mjs';

const PARENT = 'ab'.repeat(32);
const CHILD = 'cd'.repeat(32);
const PARENT_INTENT = { unitScale: 0.1, activation: 'held', direction: 'facing' };
const CHILD_INTENT = { unitScale: 0.05, activation: 'press', direction: 'opposite' };

function frameHtml(id) {
  return `<!doctype html><title>Fixture frame</title><body data-frame="${id}">Fixture playback. Not a model result.<script>
const channel = (location.hash.match(/channel=([A-Za-z0-9-]+)/) || [])[1];
addEventListener('message', (event) => {
  if (!channel || event.data?.channel !== channel) return;
  if (event.data.type === 'challenge-command' && event.data.action === 'original') document.body.dataset.watch = 'original';
});
</script></body>`;
}

function catalog(generationConfigured) {
  return {
    playback: true,
    generationConfigured,
    releasePublished: false,
    publicReservedUsd: 0,
    publicReserveUsd: 15,
    model: 'muse-spark-1.3',
    parents: [
      {
        id: PARENT,
        play: `/parents/${PARENT}`,
        download: `/parents/${PARENT}/download`,
        intent: PARENT_INTENT,
        summary: 'Fixture saved mapping.',
        parentArtifactId: null,
        parentChain: [PARENT],
        controls: 'challenge',
      },
    ],
    artifacts: [],
  };
}

function jobFor(prompt, parentId) {
  const id = randomUUID();
  const base = {
    id,
    parentArtifactId: parentId,
    artifactId: null,
    parentChain: [parentId],
    error: null,
    urls: null,
    intent: null,
    summary: null,
  };
  if (prompt.startsWith('reject')) {
    return {
      ...base,
      status: 'unsupported',
      error: 'Unsupported remix. The parent version was not changed.',
    };
  }
  if (prompt.startsWith('wait')) return { ...base, status: 'queued' };
  return {
    ...base,
    status: 'ready',
    artifactId: CHILD,
    parentChain: [parentId, CHILD],
    summary: 'Fixture published a shorter backward dash.',
    intent: CHILD_INTENT,
    urls: {
      play: `/artifacts/${CHILD}/play.html`,
      download: `/artifacts/${CHILD}/download`,
      parent: `/parents/${parentId}`,
      adapter: `/artifacts/${CHILD}/adapter.js`,
      report: `/artifacts/${CHILD}`,
      notices: `/artifacts/${CHILD}/notices.txt`,
    },
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function startFixture(html, generationConfigured, { status = 'ok' } = {}) {
  const posts = [];
  const jobs = new Map();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (status, type, body) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    if (request.method === 'GET' && url.pathname === '/') {
      send(200, 'text/html; charset=utf-8', html);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/catalog') {
      send(200, 'application/json', JSON.stringify(catalog(generationConfigured)));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/remixes/status') {
      if (status !== 'ok') {
        send(503, 'application/json', JSON.stringify({ error: 'Status unavailable' }));
        return;
      }
      send(
        200,
        'application/json',
        JSON.stringify({
          ok: true,
          generationConfigured,
          recoveryEnabled: false,
          releasePublished: false,
        }),
      );
      return;
    }
    const jobPath = url.pathname.match(/^\/api\/remixes\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && jobPath) {
      const job = jobs.get(jobPath[1].toLowerCase());
      send(job ? 200 : 404, 'application/json', JSON.stringify(job ?? { error: 'Run not found' }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/remixes') {
      const invite = request.headers['x-invite-code'];
      const body = JSON.parse(await readBody(request));
      posts.push({ invite, body });
      if (typeof invite !== 'string' || invite.length < 8) {
        send(401, 'application/json', JSON.stringify({ error: 'Invite required' }));
        return;
      }
      if (body.adultConfirmed !== true) {
        send(
          403,
          'application/json',
          JSON.stringify({ error: 'Remix creation is limited to adults 18 and older' }),
        );
        return;
      }
      const existing = jobs.get(body.idempotencyKey);
      if (existing) {
        send(202, 'application/json', JSON.stringify(existing));
        return;
      }
      const job = jobFor(body.prompt, body.parentArtifactId);
      jobs.set(body.idempotencyKey, job);
      jobs.set(job.id, job);
      send(202, 'application/json', JSON.stringify(job));
      return;
    }
    if (url.pathname === `/parents/${PARENT}` || url.pathname === `/artifacts/${CHILD}/play.html`) {
      send(
        200,
        'text/html; charset=utf-8',
        frameHtml(url.pathname.includes('artifacts') ? CHILD : PARENT),
      );
      return;
    }
    if (request.method === 'GET' && url.pathname.endsWith('/download')) {
      send(200, 'text/plain', 'fixture-download');
      return;
    }
    if (request.method === 'GET' && url.pathname.endsWith('/notices.txt')) {
      send(200, 'text/plain', 'fixture notices');
      return;
    }
    send(404, 'application/json', JSON.stringify({ error: 'Not found' }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        posts,
        close: () =>
          new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      }),
    );
  });
}

describe('creator page', { concurrency: 1 }, () => {
  let browser;
  let html;
  before(async () => {
    html = (await buildCreatorPage()).html;
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || 'chrome',
      headless: true,
    });
  });
  after(async () => {
    await browser?.close();
  });

  async function open(fixture, { clipboard = true } = {}) {
    const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (!clipboard) {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('denied')) },
        });
      });
    }
    await page.goto(fixture.origin);
    await page.locator('#creator-frame').waitFor();
    return { context, page, errors };
  }

  test(
    'unconfigured playback stays on one frame and does not create',
    { timeout: 60_000 },
    async () => {
      const fixture = await startFixture(html, false);
      const { context, page, errors } = await open(fixture);
      try {
        assert.equal(await page.locator('#creator-frame').count(), 1);
        assert.match(
          await page.locator('#creator-frame').getAttribute('sandbox'),
          /^allow-scripts$/,
        );
        assert.equal(await page.locator('#creator-disabled').isVisible(), true);
        assert.match(await page.locator('#creator-intent').innerText(), /6 m/);
        assert.equal(await page.locator('a[href*="adapter"]').count(), 0);
        assert.doesNotMatch(
          await page.locator('body').innerText(),
          /fresh recovery|worker passed|accepted recovery/i,
        );
        await page.locator('#creator-age').scrollIntoViewIfNeeded();
        await page.locator('#creator-age').check();
        await page.locator('#creator-invite').fill('invite-ok');
        await page.locator('#creator-prompt').fill('Make the dash half as long.');
        assert.equal(await page.locator('#creator-create').isDisabled(), true);
        await page.locator('#creator-create').evaluate((button) => {
          button.disabled = false;
          button.click();
        });
        await page.waitForTimeout(200);
        assert.equal(fixture.posts.length, 0);
        await page.locator('#creator-watch').click();
        await page.frameLocator('#creator-frame').locator('body').waitFor();
        assert.equal(
          await page.frameLocator('#creator-frame').locator('body').getAttribute('data-watch'),
          'original',
        );
        await page.setViewportSize({ width: 320, height: 740 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
        assert.equal(await page.locator('iframe').count(), 1);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
        await fixture.close();
      }
    },
  );

  test('a failed status read keeps creation disabled', { timeout: 60_000 }, async () => {
    const fixture = await startFixture(html, true, { status: 'down' });
    const { context, page, errors } = await open(fixture);
    try {
      await page.locator('#creator-disabled').waitFor();
      await page.locator('#creator-age').scrollIntoViewIfNeeded();
      await page.locator('#creator-age').check();
      await page.locator('#creator-invite').fill('invite-ok');
      await page.locator('#creator-prompt').fill('Make the dash half as long.');
      assert.equal(await page.locator('#creator-create').isDisabled(), true);
      assert.equal(await page.locator('#creator-frame').count(), 1);
      assert.equal(fixture.posts.length, 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await fixture.close();
    }
  });

  test('invite and age gates block a configured create', { timeout: 60_000 }, async () => {
    const fixture = await startFixture(html, true);
    const { context, page, errors } = await open(fixture);
    try {
      await page.locator('#creator-prompt').fill('Make the dash half as long.');
      assert.equal(await page.locator('#creator-create').isDisabled(), true);
      await page.locator('#creator-age').check();
      await page.locator('#creator-invite').fill('short');
      assert.equal(await page.locator('#creator-create').isDisabled(), true);
      await page.locator('#creator-invite').fill('invite-ok');
      assert.equal(await page.locator('#creator-create').isDisabled(), false);
      await page.locator('#creator-create').click();
      await page.locator('#creator-status').waitFor();
      assert.equal(fixture.posts.length, 1);
      assert.equal(fixture.posts[0].invite, 'invite-ok');
      assert.equal(fixture.posts[0].body.adultConfirmed, true);
      assert.equal(fixture.posts[0].body.parentArtifactId, PARENT);
      assert.deepEqual(Object.keys(fixture.posts[0].body).sort(), [
        'adultConfirmed',
        'idempotencyKey',
        'parentArtifactId',
        'prompt',
        'sessionId',
      ]);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await fixture.close();
    }
  });

  test(
    'a published fixture shows intent, lineage, and the copy fallback',
    { timeout: 60_000 },
    async () => {
      const fixture = await startFixture(html, true);
      const { context, page, errors } = await open(fixture, { clipboard: false });
      try {
        await page.locator('#creator-age').check();
        await page.locator('#creator-invite').fill('invite-ok');
        await page.locator('#creator-prompt').fill('Make the dash half as long.');
        await page.locator('#creator-create').click();
        await page.locator('[data-job-status="ready"]').waitFor();
        assert.equal(await page.locator('iframe').count(), 1);
        assert.match(
          await page.locator('#creator-frame').getAttribute('src'),
          new RegExp(`/artifacts/${CHILD}/play.html$`),
        );
        const intent = await page.locator('#creator-intent').innerText();
        assert.match(intent, /3 m/);
        assert.match(intent, /Backward/);
        assert.match(intent, /Fresh press/);
        assert.match(await page.locator('#creator-summary').innerText(), /Fixture published/);
        assert.equal(await page.locator(`[data-chain="${PARENT}"]`).count(), 1);
        assert.equal(await page.locator(`[data-chain="${CHILD}"]`).count(), 1);
        assert.equal(
          await page.locator('#creator-download').getAttribute('href'),
          `/artifacts/${CHILD}/download`,
        );
        assert.equal(await page.locator('a[href$="/adapter.js"]').count(), 1);
        assert.equal(await page.locator('a[href$="/notices.txt"]').count(), 1);
        await page.locator('#creator-copy').click();
        assert.equal(
          await page.locator('#creator-share-fallback').inputValue(),
          `${fixture.origin}/artifacts/${CHILD}/play.html`,
        );
        assert.doesNotMatch(await page.locator('#creator-copy-note').innerText(), /public link/i);
        await page.locator(`[data-chain="${PARENT}"]`).click();
        assert.match(
          await page.locator('#creator-frame').getAttribute('src'),
          new RegExp(`/parents/${PARENT}`),
        );
        assert.match(await page.locator('#creator-intent').innerText(), /6 m/);
        await page.locator(`[data-chain="${CHILD}"]`).click();
        await page.locator('#creator-prompt').fill('Make it three meters.');
        await page.locator('#creator-create').click();
        for (let attempt = 0; fixture.posts.length < 2 && attempt < 40; attempt += 1) {
          await page.waitForTimeout(50);
        }
        assert.equal(fixture.posts.length, 2);
        assert.equal(fixture.posts[1].body.parentArtifactId, CHILD);
        assert.match(
          await page.locator('#creator-inherit').innerText(),
          /full distance, direction, and activation/,
        );
        assert.doesNotMatch(
          await page.locator('body').innerText(),
          /fresh recovery|worker passed/i,
        );
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
        await fixture.close();
      }
    },
  );

  test('a rejected remix leaves the parent frame in place', { timeout: 60_000 }, async () => {
    const fixture = await startFixture(html, true);
    const { context, page, errors } = await open(fixture);
    try {
      const before = await page.locator('#creator-frame').getAttribute('src');
      await page.locator('#creator-age').check();
      await page.locator('#creator-invite').fill('invite-ok');
      await page.locator('#creator-prompt').fill('reject this remix');
      await page.locator('#creator-create').click();
      await page.locator('[data-job-status="unsupported"]').waitFor();
      assert.match(
        await page.locator('#creator-error').innerText(),
        /parent version was not changed/i,
      );
      assert.equal(await page.locator('#creator-frame').getAttribute('src'), before);
      assert.equal(await page.locator(`a[href="/artifacts/${CHILD}/download"]`).count(), 0);
      assert.equal(await page.locator('iframe').count(), 1);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await fixture.close();
    }
  });

  test(
    'refresh reconnects to the same job without a second create',
    { timeout: 60_000 },
    async () => {
      const fixture = await startFixture(html, true);
      const { context, page, errors } = await open(fixture);
      try {
        await page.locator('#creator-age').check();
        await page.locator('#creator-invite').fill('invite-ok');
        await page.locator('#creator-prompt').fill('wait for the fixture');
        await page.locator('#creator-create').click();
        await page.locator('[data-job-status="queued"]').waitFor();
        assert.equal(fixture.posts.length, 1);
        await page.reload();
        await page.locator('[data-job-status="queued"]').waitFor();
        await page.waitForTimeout(500);
        assert.equal(fixture.posts.length, 1);
        assert.equal(fixture.posts[0].body.idempotencyKey.length > 0, true);
        assert.equal(await page.locator('iframe').count(), 1);
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
        await fixture.close();
      }
    },
  );
});
