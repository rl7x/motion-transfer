import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './sha.mjs';
import { readStoredZip } from './zip.mjs';

async function walk(directory, prefix = '') {
  const map = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('Release contains a symlink: ' + relative);
    if (entry.isDirectory()) {
      for (const [key, value] of await walk(join(directory, entry.name), relative + '/')) map.set(key, value);
    } else map.set(relative, sha256(await readFile(join(directory, entry.name))));
  }
  return map;
}

export async function auditDirectory(root) {
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  const recorded = (await readFile(join(root, 'manifest.sha256'), 'utf8')).trim();
  assert.equal(sha256(manifestBytes), recorded, 'Manifest bytes changed');
  const parsed = JSON.parse(manifestBytes.toString('utf8'));
  const { id, ...body } = parsed;
  assert.equal(sha256(JSON.stringify(body)), id, 'Manifest identity changed');
  assert.equal(body.kind, 'motion-transfer-static-release');
  assert.equal(body.creation, 'unavailable');
  const found = await walk(root);
  for (const path of found.keys()) {
    const name = path.split('/').pop();
    assert.notEqual(name, '.env');
    assert.notEqual(name, 'phase-budget.json');
    assert.equal(name.endsWith('.journal.json'), false);
  }
  assert.deepEqual([...found.keys()].sort(), [...Object.keys(body.files), 'manifest.json', 'manifest.sha256'].sort());
  for (const [path, hash] of Object.entries(body.files)) assert.equal(found.get(path), hash, path);
  const motion = JSON.parse(await readFile(join(root, 'motion-data.json'), 'utf8'));
  assert.equal(motion.generation, 'playback-only');
  assert.equal(motion.recovery, 'saved');
  assert.equal(motion.publicOrigin, body.publicOrigin);
  assert.equal(motion.resources['/api/lab/status'].enabled, false);
  assert.equal(motion.resources['/api/remixes/status'].enabled, false);
  assert.equal(motion.resources['/api/transfer'].status, 'playback-only');
  const index = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(index, /playback-only/);
  assert.match(index, /Creation is unavailable/);
  assert.equal(/(?:src|href)="\//.test(index), false);
  if (!body.publicOrigin) assert.match(index, /data-share-state="unconfigured"/);
  const byId = new Map(body.versions.map(version => [version.id, version]));
  assert.ok(byId.has(body.featuredId), 'Featured version is missing');
  for (let indexInChain = 1; indexInChain < body.remixChain.length; indexInChain += 1) {
    assert.equal(byId.get(body.remixChain[indexInChain]).parentArtifactId, body.remixChain[indexInChain - 1]);
  }
  for (const version of body.versions) {
    const source = JSON.parse(await readFile(join(root, version.source), 'utf8'));
    const entries = readStoredZip(await readFile(join(root, version.download)));
    for (const [name, hash] of Object.entries(source.files)) {
      assert.equal(entries.has(name), true, name);
      assert.equal(sha256(entries.get(name)), hash, name);
    }
    const frameHash = sha256(await readFile(join(root, version.frame)));
    assert.equal(frameHash, source.files['frame.html'] ?? source.files['play.html']);
    const directory = join(root, 'versions', version.id);
    assert.equal(sha256(await readFile(join(directory, 'notices.txt'))), source.files['notices.txt']);
    assert.equal(sha256(await readFile(join(directory, 'adapter.ts'))), source.files['adapter.ts']);
    const evidenceName = source.files['challenge.json'] ? 'challenge.json' : 'verification.json';
    assert.equal(sha256(await readFile(join(directory, evidenceName))), source.files[evidenceName]);
    const page = await readFile(join(root, version.play), 'utf8');
    assert.match(page, /Creation is unavailable/);
    assert.equal(page.includes('src="/'), false);
    assert.equal(page.includes('href="/'), false);
    if (!body.publicOrigin) assert.match(page, /data-share-state="unconfigured"/);
    if (version.parentArtifactId && byId.has(version.parentArtifactId)) {
      assert.match(page, new RegExp('data-parent href="\\.\\./' + version.parentArtifactId + '/index.html"'));
    }
  }
  const featured = byId.get(body.featuredId);
  const challengeKey = '/api/roadster/challenge/' + featured.parentArtifactId;
  if (motion.resources[challengeKey]) {
    assert.equal(motion.resources[challengeKey].play.startsWith('/versions/'), true);
    assert.equal(motion.resources[challengeKey].play.startsWith('http'), false);
  }
  return parsed;
}
