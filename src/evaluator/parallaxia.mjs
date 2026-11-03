import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { evaluateRoadsterAdapter } from './roadster.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';
import { resolveComponentRef, componentIdentity } from '../component/reference.mjs';
import { parallaxiaDescriptor } from '../parallaxia/recipient.mjs';
import { assertParallaxiaSource } from './parallaxia-source.mjs';

export async function evaluateParallaxiaAdapter(source, intent, { componentRef, ruleSource = null } = {}) {
  assertParallaxiaSource(source);
  const component = await resolveComponentRef(componentRef);
  const conformance = await evaluateRoadsterAdapter(source, intent, { componentRef: component });
  const compiled = await compileAdapter(source, { componentRef: component });
  const pending = promisify(execFile)(process.execPath, ['--max-old-space-size=128', fileURLToPath(new URL('parallaxia-native-worker.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH ?? '' }, timeout: 15000, maxBuffer: 1048576,
  });
  pending.child.stdin.end(JSON.stringify({ adapterCode: compiled.code, componentCode: compiled.componentCode, defaults: compiled.defaults, intent, ruleSource }));
  const native = JSON.parse((await pending).stdout);
  const results = [...conformance.results, ...native.results];
  return { ...conformance, gate: 'parallaxia-native', passed: results.every(result => result.passed),
    componentRef: componentIdentity(component), recipient: await parallaxiaDescriptor(), collisionPolicy: 'native',
    addedDashInvulnerability: false, results };
}
