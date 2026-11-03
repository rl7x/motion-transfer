import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import { loadParallaxia } from '../recipients/parallaxia/load.mjs';

export async function parallaxiaDescriptor() {
  const recipient = await loadParallaxia();
  const hooks = {};
  for (const file of ['sim.mjs', 'port.mjs', 'challenge-contract.mjs', 'replay.mjs', '../web/parallaxia-entry.js']) {
    hooks[file] = digest(await readFile(new URL(file, import.meta.url)));
  }
  return {
    id: 'parallaxia', name: 'PARALLAXIA', revision: recipient.manifest.revision,
    tickRate: 60, units: 'world-units', sourcePixelsToWorldUnits: 0.1,
    unitMapping: 'One source pixel maps to 0.1 world units; the eight-update 60-pixel dash maps to 6 world units. Canvas renders 10 pixels per world unit.',
    nativeEvents: ['shot', 'miss', 'graze'], abilityEvents: ['dash-start', 'dash-end'],
    supportedChanges: ['unitScale', 'activation', 'direction'],
    collisionPolicies: ['native', 'practice-shield'],
    collisionPolicy: 'native', addedDashInvulnerability: false,
    buildEntry: 'parallaxia/build.mjs', verificationEntry: 'evaluator/parallaxia.mjs',
    hooks, hooksSha256: digest(JSON.stringify(hooks)), notices: recipient.notices,
  };
}
