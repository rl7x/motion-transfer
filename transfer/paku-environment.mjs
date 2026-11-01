import { readFile } from 'node:fs/promises';
import { digest } from '../component/build.mjs';
import { loadRecoveredMotion } from '../component/load.mjs';
import { loadPakuPaku } from '../recipients/paku-paku/load.mjs';
import { PAKU_POLICY } from './paku-policy.mjs';

export async function pakuEnvironment() {
  const [component, recipient] = await Promise.all([loadRecoveredMotion(), loadPakuPaku()]);
  const files = {};
  for (const path of [
    'runtime/paku-browser.mjs', 'web/clock.js', 'web/boot.js', 'web/port.js', 'web/play.html',
    'web/server.mjs', 'transfer/output.mjs', 'transfer/adapter.mjs', 'transfer/worker.mjs',
    'transfer/paku-policy.mjs', 'evaluator/paku-adapter.mjs', 'evaluator/paku-browser.mjs',
    'evaluator/browser-harness.mjs',
  ]) files[path] = digest(await readFile(new URL('../' + path, import.meta.url)));
  return {
    componentId: component.provenance.id,
    recipient: recipient.manifest,
    runtimeSha256: digest(recipient.runtime), soundSha256: digest(recipient.sound),
    policy: PAKU_POLICY, files,
  };
}
