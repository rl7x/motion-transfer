import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolveComponentRef, componentIdentity } from '../component/reference.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { digest } from '../component/build.mjs';
import { ROADSTER_INTENT } from '../roadster/port.mjs';
import { PARALLAXIA_CHALLENGE } from './challenge-contract.mjs';
import { buildParallaxiaFrame } from './build.mjs';
import { evaluateRoadsterAdapter } from '../evaluator/roadster.mjs';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('challenge-worker.mjs', import.meta.url));

function targetForIntent(intent = ROADSTER_INTENT) {
  if (
    intent.direction === ROADSTER_INTENT.direction &&
    Math.abs(intent.unitScale - ROADSTER_INTENT.unitScale) < 1e-6
  ) {
    return PARALLAXIA_CHALLENGE.target;
  }
  const dashShift = 60 * intent.unitScale * (intent.direction === 'opposite' ? -1 : 1);
  const transferredX = -4.8 + dashShift;
  return Object.freeze({
    minX: Number((transferredX - 0.8).toFixed(2)),
    maxX: Number((transferredX + 1.8).toFixed(2)),
  });
}

/** Execute generated adapter code only in the bounded, credential-free worker. */
export async function measureParallaxiaChallenge({
  source,
  intent = ROADSTER_INTENT,
  componentRef,
  target = targetForIntent(intent),
} = {}) {
  const component = await resolveComponentRef(componentRef);
  const adapter = await compileAdapter(source, { componentRef: component });
  const pending = execute(process.execPath, ['--max-old-space-size=128', worker], {
    env: { PATH: process.env.PATH ?? '' },
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  pending.child.stdin.end(
    JSON.stringify({
      adapterCode: adapter.code,
      componentCode: adapter.componentCode,
      defaults: adapter.defaults,
      intent,
      target,
    }),
  );
  let output;
  try {
    output = JSON.parse((await pending).stdout);
  } catch (error) {
    if (error.killed) throw Error('Challenge verification exceeded its process time limit');
    let failure;
    try {
      failure = JSON.parse(error.stdout);
    } catch {
      /* The worker may have exited before producing JSON. */
    }
    throw Error(failure?.error ?? 'Challenge verification worker failed');
  }
  if (output.error || !Array.isArray(output.controls) || !output.controls.length) {
    throw Error(output.error ?? 'Invalid challenge verification');
  }
  return {
    ...output,
    componentId: component.provenance.id,
    componentRef: componentIdentity(component),
    sourceSha256: adapter.sourceSha256,
    controlsSha256: digest(JSON.stringify(output.controls)),
    scope:
      'Human-authored PARALLAXIA barrage challenge. Matched recorded native 60 Hz pilot inputs, with one extra phase-dash in the transferred run; native simulation and collisions stay active.',
  };
}

/** Build a new PARALLAXIA challenge delivery around an immutable parent; never rewrite the saved artifact. */
export async function buildParallaxiaChallenge({ parent, componentRef = parent?.component } = {}) {
  const component = await resolveComponentRef(componentRef);
  if (!parent?.files?.['adapter.ts'] || parent.componentId !== component.provenance.id) {
    throw Error('Challenge parent and component identities differ');
  }
  const source = parent.files['adapter.ts'];
  const intent = parent.intent;
  const target = targetForIntent(intent);
  const measurement = await measureParallaxiaChallenge({
    source,
    intent,
    componentRef: component,
    target,
  });
  const conformance = await evaluateRoadsterAdapter(source, intent, { componentRef: component });
  if (!conformance.passed || !measurement.passed) {
    throw Error('Challenge execution did not pass recipient checks');
  }
  const overlap = Math.min(
    measurement.baseline.frames.length,
    measurement.transferred.frames.length,
  );
  const maxVerticalDifference = Math.max(
    ...measurement.baseline.frames
      .slice(0, overlap)
      .map((frame, index) =>
        Math.abs(frame.car.position.y - measurement.transferred.frames[index].car.position.y),
      ),
  );
  const challenge = {
    ...PARALLAXIA_CHALLENGE,
    target,
    controls: measurement.controls,
    controlsSha256: measurement.controlsSha256,
    dashTick: measurement.dashTick,
  };
  const frame = await buildParallaxiaFrame({
    source,
    intent,
    componentRef: component,
    challenge,
  });
  const verification = {
    schemaVersion: 1,
    passed: true,
    kind: 'matched-native-challenge',
    componentId: component.provenance.id,
    componentRef: componentIdentity(component),
    parentArtifactId: parent.id,
    sourceSha256: digest(source),
    frameSha256: digest(frame.html),
    controlsSha256: measurement.controlsSha256,
    conformance,
    maxVerticalDifference,
    netLandingShiftMeters:
      measurement.transferred.landing.position.x - measurement.baseline.landing.position.x,
    ordinaryOutsideTarget: !measurement.baseline.inTarget,
    borrowedInsideTarget: measurement.transferred.inTarget,
    measurement,
    environment: frame.environment,
    scope: measurement.scope,
  };
  const notice = await readFile(
    new URL('../targets/dashy-dango/NOTICE.txt', import.meta.url),
    'utf8',
  );
  const files = {
    'play.html': frame.html,
    'challenge.json': JSON.stringify(verification, null, 2) + '\n',
    'adapter.ts': source,
    'component.json': JSON.stringify(component, null, 2) + '\n',
    'notices.txt': notice + '\n\n' + frame.recipient.notices,
  };
  const manifest = {
    schemaVersion: 1,
    kind: 'roadster-challenge',
    parentArtifactId: parent.id,
    componentId: component.provenance.id,
    componentRef: componentIdentity(component),
    intent,
    files: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, digest(bytes)]),
    ),
  };
  const id = digest(JSON.stringify(manifest));
  files['manifest.json'] = JSON.stringify({ id, ...manifest }, null, 2) + '\n';
  return { id, ...manifest, files, verification, challenge };
}
