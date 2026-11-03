import { readFile } from 'node:fs/promises';
import { shareDecision } from './share.mjs';
import { zipStored } from './zip.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const text = value => Buffer.isBuffer(value) ? value : Buffer.from(String(value));

export function reportInject(verificationText) {
  const parsed = JSON.parse(verificationText);
  if (!Array.isArray(parsed.conformance?.results) || !Array.isArray(parsed.browser?.results)) {
    throw Error('Saved verification is missing conformance or browser results');
  }
  return { conformance: { results: parsed.conformance.results }, browser: { results: parsed.browser.results } };
}

export function motionData(release) {
  const challenge = release.versions.find(version => version.id === release.featuredId);
  const parent = challenge && release.versions.find(version => version.id === challenge.parentArtifactId);
  const resources = {
    '/api/ability': {
      id: release.componentId, name: 'Dash',
      status: release.recovery === 'accepted' ? 'accepted-recovery' : 'saved-recovery',
    },
    '/api/transfer': { status: 'playback-only' },
    '/api/destinations': {
      componentId: release.componentId,
      destinations: parent && parent.componentId === release.componentId ? [roadsterDestination(release, parent)] : [],
    },
    '/api/lab/status': { enabled: false, activeRunId: null, budget: null, creation: 'unavailable' },
    '/api/remixes/status': { enabled: false, activeRunId: null, budget: null, creation: 'unavailable' },
  };
  if (parent?.report) {
    resources['/api/roadster/artifacts/' + parent.id] = {
      id: parent.id, parentArtifactId: parent.parentArtifactId, componentId: parent.componentId,
      intent: parent.intent, summary: parent.summary,
      conformanceChecks: parent.report.conformance.results.length,
      browserChecks: parent.report.browser.results.length,
      ...(parent.model ? { model: parent.model } : {}),
      ...(Number.isFinite(parent.estimatedCostUsd) ? { estimatedCostUsd: parent.estimatedCostUsd } : {}),
      ...(Number.isFinite(parent.estimatedGenerationCostUsd) ? { estimatedGenerationCostUsd: parent.estimatedGenerationCostUsd } : {}),
    };
    resources['/roadster/artifacts/' + parent.id + '/report.json'] = parent.report;
  }
  if (challenge?.api && parent) {
    resources['/api/roadster/challenge/' + parent.id] = {
      id: challenge.id, parentArtifactId: parent.id, componentId: challenge.componentId,
      target: challenge.api.target, measurements: challenge.api.measurements,
      ordinaryOutsideTarget: challenge.api.ordinaryOutsideTarget,
      borrowedInsideTarget: challenge.api.borrowedInsideTarget,
      play: '/versions/' + challenge.id + '/frame.html',
      download: '/versions/' + challenge.id + '/download.zip',
      source: '/versions/' + challenge.id + '/source.json',
      report: '/versions/' + challenge.id + '/' + challenge.evidenceName,
    };
  }
  const recovery = release.recovery === 'accepted' ? 'accepted' : 'saved';
  return {
    generation: 'playback-only', publicOrigin: release.publicOrigin, recovery,
    ...(release.jujumpComparison ? { jujumpComparison: release.jujumpComparison } : {}),
    resources,
  };
}

function roadsterDestination(release, parent) {
  return {
    id: 'roadster', name: 'RDSTR STUNTS', kind: 'A 3D Roadster stunt simulation',
    componentId: release.componentId, artifactId: parent.id, aspect: 1.5,
    before: '/roadster/play?mode=original&quality=low',
    after: '/roadster/play?mode=transfer&quality=low',
    keeps: 'Its ramp, gravity, rotation, lift thrusters, fuel, and native landing and collision rules.',
    carries: 'The same eight-update burst and recharge, now a six-meter air dash.',
    control: 'Run the stunt with the assisted driver, then hold X to dash in the air.',
    action: 'Run stunt', dashKey: 'X', liveEdits: ['distance', 'activation', 'direction'],
    report: '/versions/' + parent.id + '/' + parent.evidenceName,
    source: '/versions/' + parent.id + '/adapter.ts',
    author: 'Meta-generated adapter; human-built host, presentation and verification; upstream simulation by sebayaki',
  };
}

function shareBlock(publicOrigin, relativePath) {
  const share = shareDecision(publicOrigin, relativePath);
  if (!share.configured) return `<p data-share data-share-state="unconfigured">${escapeHtml(share.text)}</p>`;
  return `<a data-share href="${escapeHtml(share.url)}">${escapeHtml(share.text)}</a>`;
}

function versionPage(version, release) {
  const known = new Set(release.versions.map(item => item.id));
  const parent = version.parentArtifactId && known.has(version.parentArtifactId)
    ? `<a data-parent href="../${version.parentArtifactId}/index.html">Parent version</a>`
    : version.parentArtifactId
      ? `<p data-parent-missing>Parent ${escapeHtml(version.parentArtifactId)} is not in this copy.</p>`
      : `<p data-root>${release.recovery === 'accepted' ? 'Accepted root. This version has no parent.' : 'Saved root. This version has no parent.'}</p>`;
  const landing = version.api ? `<p data-landing>The recorded native controls land at ${version.api.measurements.baselineLandingX.toFixed(2)} m. The same controls plus the borrowed dash land at ${version.api.measurements.transferredLandingX.toFixed(2)} m.</p>` : '';
  const activation = version.intent?.activation === 'press' ? 'press' : 'held';
  const player = version.protocol === 'challenge'
    ? `<section data-release-player data-src="frame.html" data-activation="${activation}"></section><script type="module" src="../../assets/release-player.js"></script>`
    : '<section data-release-player><iframe src="frame.html" title="Saved playable version" sandbox="allow-scripts" allow="autoplay"></iframe></section>';
  return `<!doctype html><html lang="en" data-generation="playback-only"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(version.title)}</title><link rel="stylesheet" href="../../release.css"></head><body><main class="release-version"><p>Playback only. Creation is unavailable.</p><h1>${escapeHtml(version.title)}</h1><p>${escapeHtml(version.summary)}</p>${landing}${player}<div class="links">${parent}<a href="frame.html">Isolated game</a><a href="download.zip" download>Download exact files</a><a href="source.json">Source identity</a><a href="adapter.ts">Adapter source</a><a href="${escapeHtml(version.evidenceName)}">Evidence</a><a href="notices.txt">Notices</a><a href="../../index.html">All versions</a></div>${shareBlock(release.publicOrigin, 'versions/' + version.id + '/index.html')}<h2>Notices</h2><pre>${escapeHtml(version.notices)}</pre></main></body></html>`;
}

function indexPage(release, jsonText) {
  const links = release.versions.map(version => `<a href="versions/${version.id}/index.html">${escapeHtml(version.kind === 'roadster-challenge' ? 'Challenge' : version.title)}</a>`).join('');
  return `<!doctype html><html lang="en" data-generation="playback-only"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Motion Transfer · Play a saved dash</title><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="release.css"></head><body><header class="release-bar"><strong>Motion Transfer</strong><span>Playback only. Creation is unavailable.</span><a href="NOTICE.txt">Donor notice</a>${shareBlock(release.publicOrigin, 'index.html')}</header><nav class="release-bar" aria-label="Saved versions">${links}</nav><div id="root"></div><script type="application/json" id="motion-data">${jsonText}</script><script src="release-boot.js"></script><script type="module" src="assets/app.js"></script></body></html>`;
}

export async function materialize(release) {
  if(release.recipient?.id==='parallaxia')return (await import('./parallaxia-materialize.mjs')).materializeParallaxia(release);
  if (!release.versions.some(version => version.id === release.featuredId)) throw Error('Featured version is missing');
  const needsPlayer = release.versions.some((version) => version.protocol === 'challenge');
  if (needsPlayer && !release.shell?.playerJs) throw Error('Challenge pages need the release player bundle');
  const files = {
    'release-boot.js': await readFile(new URL('./boot.js', import.meta.url)),
    'release.css': await readFile(new URL('./release.css', import.meta.url)),
    'style.css': text(release.shell.css),
    'assets/app.js': text(release.shell.appJs),
    ...(release.shell?.playerJs ? { 'assets/release-player.js': text(release.shell.playerJs) } : {}),
    '.nojekyll': '',
    'PLAYBACK.txt': 'Static playback. Creation is unavailable. Open index.html. Version URLs are versions/<id>/index.html and the isolated game is frame.html.\n',
  };
  for (const [path, contents] of Object.entries(release.extras ?? {})) files[path] = text(contents);
  const data = motionData(release);
  const jsonText = JSON.stringify(data).replace(/</g, '\\u003c');
  files['motion-data.json'] = jsonText;
  files['index.html'] = indexPage(release, jsonText);
  for (const version of release.versions) {
    const base = 'versions/' + version.id + '/';
    files[base + 'frame.html'] = text(version.frame);
    files[base + 'source.json'] = text(version.sourceBytes);
    files[base + 'notices.txt'] = text(version.notices);
    files[base + 'adapter.ts'] = text(version.adapter);
    files[base + version.evidenceName] = text(version.evidenceBytes);
    files[base + 'download.zip'] = zipStored(version.zipFiles);
    files[base + 'lineage.json'] = JSON.stringify({ id: version.id, kind: version.kind, parentArtifactId: version.parentArtifactId,
      componentId: version.componentId, exactFrame: true, creation: 'unavailable', origin: version.origin }, null, 2) + '\n';
    files[base + 'index.html'] = versionPage(version, release);
  }
  return files;
}
