import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest } from '../component/build.mjs';
import { projectZip } from './archive.mjs';
import { extractIntegration, serveIntegration } from '../evaluator/integration-harness.mjs';

function verifyProject(project, verification) {
  const { id, ...manifest } = project.manifest;
  assert.equal(digest(JSON.stringify(manifest)), id, 'Integration manifest identity mismatch');
  assert.deepEqual(Object.keys(project.files).sort(), [...Object.keys(manifest.files), 'manifest.json'].sort());
  for (const [path, expected] of Object.entries(manifest.files)) {
    assert.equal(digest(project.files[path]), expected.sha256, 'Integration file identity mismatch: ' + path);
    assert.equal(Buffer.byteLength(project.files[path]), expected.bytes);
  }
  assert.deepEqual(JSON.parse(project.files['manifest.json']), project.manifest);
  assert.equal(digest(projectZip(project.files)), project.zipSha256, 'Integration ZIP identity mismatch');
  if (project.zip) assert.equal(digest(project.zip), project.zipSha256, 'Delivered ZIP identity mismatch');
  assert.deepEqual(JSON.parse(project.files['case-study.json']), project.caseStudy);
  assert.equal(verification.passed, true, 'Standalone verification must pass before publication');
  assert.equal(verification.packageId, id); assert.equal(verification.zipSha256, project.zipSha256);
  assert.equal(verification.componentId, manifest.componentId);
  assert.equal(verification.nodeChecks?.passed, true); assert.equal(verification.nodeChecks.count, 3);
  assert.equal(verification.browser?.passed, true);
  assert.equal(verification.browser.results.length, 7);
  assert.ok(verification.browser.results.every(result => result.passed));
  assert.deepEqual(verification.externalRequests, []); assert.deepEqual(verification.nonGetRequests, []);
}

export function createIntegrationPublication(directory) {
  const root = join(directory, 'integrations');
  const previews = new Map();
  return {
    async publish({ project, verification }) {
      verifyProject(project, verification);
      const data = { files: project.files, manifest: project.manifest, zipSha256: project.zipSha256, caseStudy: project.caseStudy };
      const receipt = { schemaVersion: 1, componentId: project.manifest.componentId, packageId: project.manifest.id,
        candidateId: verification.candidateId, sessionId: verification.sessionId, zipSha256: project.zipSha256,
        projectSha256: digest(JSON.stringify(data)), verificationSha256: digest(JSON.stringify(verification)) };
      const id = digest(JSON.stringify(receipt)), path = join(root, id), temporary = path + '.' + randomUUID() + '.tmp';
      await mkdir(root, { recursive: true }); await mkdir(temporary);
      try {
        await writeFile(join(temporary, 'project.json'), JSON.stringify(data));
        await writeFile(join(temporary, 'validation.json'), JSON.stringify(verification));
        await writeFile(join(temporary, 'receipt.json'), JSON.stringify({ id, ...receipt }));
        await rename(temporary, path);
      } finally { await rm(temporary, { recursive: true, force: true }); }
      return { id, componentId: receipt.componentId, candidateId: receipt.candidateId, packageId: receipt.packageId,
        zipSha256: receipt.zipSha256, archiveBytes: project.zip.length, fileCount: Object.keys(project.files).length };
    },
    async read(id) {
      assert.match(id, /^[a-f0-9]{64}$/, 'Invalid integration identity');
      const path = join(root, id);
      const [{ id: storedId, ...receipt }, project, verification] = await Promise.all(['receipt.json', 'project.json', 'validation.json']
        .map(async name => JSON.parse(await readFile(join(path, name), 'utf8'))));
      assert.equal(storedId, id); assert.equal(digest(JSON.stringify(receipt)), id);
      assert.equal(digest(JSON.stringify(project)), receipt.projectSha256);
      assert.equal(digest(JSON.stringify(verification)), receipt.verificationSha256);
      assert.equal(project.manifest.id, receipt.packageId);
      assert.equal(project.manifest.componentId, receipt.componentId);
      assert.equal(project.zipSha256, receipt.zipSha256);
      assert.equal(verification.candidateId, receipt.candidateId); assert.equal(verification.sessionId, receipt.sessionId);
      verifyProject(project, verification);
      return { id, receipt, project: { ...project, zip: projectZip(project.files) }, verification };
    },
    async preview(id) {
      // Use a different, GET-only origin. Generated code never shares the lab's
      // origin, API admission or credentials. A preview is recreated after restart.
      if (previews.has(id)) return (await previews.get(id)).server.origin;
      if (previews.size >= 2) {
        const [oldId, pending] = previews.entries().next().value;
        const old = await pending; await old.server.close(); await old.extracted.close(); previews.delete(oldId);
      }
      const pending = (async () => {
        const { project } = await this.read(id), extracted = await extractIntegration(project);
        try { return { extracted, server: await serveIntegration(extracted.directory) }; }
        catch (error) { await extracted.close(); throw error; }
      })();
      previews.set(id, pending);
      try { return (await pending).server.origin; }
      catch (error) { previews.delete(id); throw error; }
    },
    async close() {
      for (const pending of previews.values()) {
        const { server, extracted } = await pending;
        await server.close(); await extracted.close();
      }
      previews.clear();
    },
  };
}
