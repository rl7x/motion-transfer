import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadParallaxia } from '../recipients/parallaxia/load.mjs';
import { resolveComponentRef, componentIdentity } from '../component/reference.mjs';
import { PARALLAXIA_SOURCE, parallaxiaHooks } from './sim.mjs';
import { ROADSTER_INTENT, validateRoadsterIntent } from '../roadster/port.mjs';
import { parallaxiaDescriptor } from './recipient.mjs';
import { digest } from '../component/build.mjs';

const cache = new Map();

export async function buildParallaxiaFrame({
  source = null,
  intent = ROADSTER_INTENT,
  componentRef,
  challenge,
  collisionPolicy = challenge ? 'practice-shield' : 'native',
} = {}) {
  validateRoadsterIntent(intent);
  if (!['native', 'practice-shield'].includes(collisionPolicy)) throw Error('Unsupported collision policy');
  const recipient = await loadParallaxia();
  const component = await resolveComponentRef(componentRef);
  const donorNotice = await readFile(
    new URL('../targets/dashy-dango/NOTICE.txt', import.meta.url),
    'utf8',
  );
  if (
    component.contract.interfaceVersion !== 1 ||
    component.contract.tickRate !== 60 ||
    component.contract.units !== 'source-pixels-per-tick'
  ) {
    throw Error('PARALLAXIA needs the verified 60 Hz source-pixel component interface');
  }
  const hostFiles = [
    'parallaxia/build.mjs',
    'parallaxia/sim.mjs',
    'parallaxia/challenge-contract.mjs',
    'roadster/port.mjs',
    'parallaxia/port.mjs',
    'parallaxia/recipient.mjs',
    'web/parallaxia-entry.js',
    'transfer/adapter.mjs',
    'transfer/worker.mjs',
    'component/reference.mjs',
  ];
  const host = Object.fromEntries(
    await Promise.all(
      hostFiles.map(async (path) => [
        path,
        digest(await readFile(new URL('../' + path, import.meta.url))),
      ]),
    ),
  );
  if (challenge) {
    host['web/parallaxia-challenge-entry.js'] = digest(
      await readFile(new URL('../web/parallaxia-challenge-entry.js', import.meta.url)),
    );
  }
  const environment = {
    recipient: await parallaxiaDescriptor(),
    collisionPolicy,
    addedDashInvulnerability: false,
    componentId: component.provenance.id,
    componentRef: componentIdentity(component),
    donorNoticeSha256: digest(donorNotice),
    recipientRevision: recipient.manifest.revision,
    recipientFiles: recipient.manifest.files,
    host,
    ...(challenge
      ? {
          challenge: {
            id: challenge.id,
            controlsSha256: challenge.controlsSha256,
            target: challenge.target,
          },
        }
      : {}),
    presentation: {
      author: 'Human-authored recipient presentation',
      afterimageLifetimeUpdates: 5,
      renderedHoldUpdates: 3,
      scope:
        'Visual hold and pixel-art ship afterimages; component and simulated motion are unchanged.',
    },
  };
  const key = digest(JSON.stringify({ source, intent, environment, challenge }));
  if (cache.has(key)) return cache.get(key);
  const entry = await readFile(
    new URL(
      challenge ? '../web/parallaxia-challenge-entry.js' : '../web/parallaxia-entry.js',
      import.meta.url,
    ),
    'utf8',
  );
  const modules = {
    'roadster-entry': entry,
    'roadster-adapter': source ?? 'export const init=null;export const step=null;',
    'roadster-core': component.javascript,
    'roadster-config': `export default ${JSON.stringify({
      defaults: component.contract.defaults,
      intent,
      componentId: component.provenance.id,
      transferred: Boolean(source),
      collisionPolicy,
      ...(challenge ? { challenge } : {}),
    })};`,
  };
  const virtual = {
    name: 'parallaxia-frame',
    setup(buildInstance) {
      buildInstance.onResolve({ filter: /^roadster-(entry|adapter|core|config)$/ }, (args) => ({
        path: args.path,
        namespace: 'motion-parallaxia',
      }));
      buildInstance.onLoad({ filter: /.*/, namespace: 'motion-parallaxia' }, (args) => ({
        contents: modules[args.path],
        resolveDir: fileURLToPath(new URL('../web/', import.meta.url)),
        loader: args.path === 'roadster-adapter' ? 'ts' : 'js',
      }));
    },
  };
  const result = await build({
    entryPoints: ['roadster-entry'],
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    target: 'es2022',
    minify: true,
    alias: { '@': PARALLAXIA_SOURCE },
    plugins: [virtual, parallaxiaHooks()],
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const notices = donorNotice + '\n\n' + recipient.notices;
  const html = `<!doctype html><html lang="en"><head><!-- Intended audience: adults 18 and older.\n${notices.replace(/-->/g, '-- >')} --><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"><title>PARALLAXIA ${source ? '+ recovered dash' : 'before transfer'}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000008;display:flex;align-items:center;justify-content:center}#scene{height:100%;width:auto;max-width:100%;aspect-ratio:220/336;display:block;image-rendering:pixelated;image-rendering:crisp-edges}#ui{position:fixed;inset:0;pointer-events:none}.transfer-meter{position:fixed;bottom:8px;left:8px;padding:7px 10px;background:#101610dd;color:#c6ed89;font:11px monospace;z-index:15;pointer-events:none}</style></head><body><canvas id="scene"></canvas><div id="ui"></div><div class="transfer-meter" id="transfer-meter"></div><script>${javascript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  const artifact = {
    html,
    environment,
    sourceSha256: source ? digest(source) : null,
    componentId: component.provenance.id,
    recipient,
    intent,
  };
  cache.set(key, artifact);
  return artifact;
}
