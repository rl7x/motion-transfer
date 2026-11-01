import { loadEnvFile } from 'node:process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { recoverMotion } from '../agent/recover-motion.mjs';
import { prepareMotionEvidence } from '../agent/motion-evidence.mjs';
import { writeMotionPackage } from '../component/package.mjs';

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'prepare-only': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('npm run recover:motion -- [--prepare-only] [--out reports/recoveries/run-id]');
    console.log('Default: at most 2 Meta synthesis calls, $0.30 estimated budget, then independent evaluation.');
    console.log('--prepare-only writes binary/trace evidence without reading .env or making API calls.');
    return;
  }
  if (!values['prepare-only']) {
    try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not load .env'); }
    if (!process.env.MODEL_API_KEY?.trim()) throw new Error('MODEL_API_KEY is not set');
  }
  const directory = resolve(values.out ?? `reports/recoveries/${randomUUID()}`);
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory);
  console.log(`Recovery directory: ${directory}`);
  const evidence = await prepareMotionEvidence();
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (values['prepare-only']) {
    console.log('Prepared compiled-function and development-trace evidence. No Meta API requests made.');
    return;
  }
  const report = await recoverMotion({
    apiKey: process.env.MODEL_API_KEY, model: process.env.META_MODEL?.trim() || 'muse-wonder-1.0', evidence,
    onProgress: message => console.log(message),
    onUpdate: async report => {
      await writeFile(join(directory, 'report.json.tmp'), JSON.stringify(report, null, 2) + '\n');
      await rename(join(directory, 'report.json.tmp'), join(directory, 'report.json'));
    },
  });
  const artifact = await writeMotionPackage(join(directory, 'component'), report, evidence);
  console.log(`Accepted motion component: ${artifact.id}`);
  console.log(`Component: ${join(directory, 'component')}`);
  console.log(`Estimated token cost: $${report.estimatedCostUsd.toFixed(4)}. No recipient integration has been evaluated.`);
}

main().catch(error => {
  const key = process.env.MODEL_API_KEY;
  console.error(key ? error.message.replaceAll(key, '[redacted]') : error.message);
  if (error.report) console.error(`Accounted cost: $${error.report.estimatedCostUsd.toFixed(4)}; unsettled reservation: $${error.report.reservedCostUsd.toFixed(4)}.`);
  process.exitCode = 1;
});
