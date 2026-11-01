import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { transferPaku, prepareTransferEvidence } from '../agent/transfer-paku.mjs';
import { compileAdapter } from '../transfer/adapter.mjs';

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, 'prepare-only': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('npm run transfer:paku -- [--prepare-only] [--out reports/transfers/run-id]');
    console.log('At most 2 Meta Spark calls and $0.05 estimated token spend. Browser verification is a separate gate.');
    return;
  }
  if (!values['prepare-only']) {
    try { loadEnvFile(resolve('.env')); } catch (error) { if (error.code !== 'ENOENT') throw Error('Could not load .env'); }
    if (!process.env.MODEL_API_KEY?.trim()) throw Error('MODEL_API_KEY is not set');
  }
  const directory = resolve(values.out ?? `reports/transfers/${randomUUID()}`);
  await mkdir(dirname(directory), { recursive: true }); await mkdir(directory);
  console.log(`Transfer directory: ${directory}`);
  const evidence = await prepareTransferEvidence();
  await writeFile(join(directory,'evidence.json'), JSON.stringify(evidence,null,2)+'\n');
  if (values['prepare-only']) { console.log('Prepared transfer evidence; no Meta API requests made.'); return; }
  const report = await transferPaku({ apiKey: process.env.MODEL_API_KEY, evidence,
    onProgress: message => console.log(message),
    onUpdate: async report => {
      await writeFile(join(directory,'generation.json.tmp'), JSON.stringify(report,null,2)+'\n');
      await rename(join(directory,'generation.json.tmp'),join(directory,'generation.json'));
    },
  });
  const attempt = report.attempts.find(item=>item.attempt===report.selectedAttempt);
  const compiled = await compileAdapter(attempt.candidate.source);
  await writeFile(join(directory,'adapter.ts'),attempt.candidate.source);
  await writeFile(join(directory,'adapter.js'),compiled.javascript);
  await writeFile(join(directory,'conformance.json'),JSON.stringify(attempt.conformance,null,2)+'\n');
  console.log(`Adapter conformance passed. Browser checks are still required. Estimated API cost: $${report.estimatedCostUsd.toFixed(5)}.`);
}
main().catch(error=>{
  const key=process.env.MODEL_API_KEY;
  console.error(key?error.message.replaceAll(key,'[redacted]'):error.message);
  if(error.report)console.error(`Accounted cost $${error.report.estimatedCostUsd.toFixed(5)}; unsettled reservation $${error.report.reservedCostUsd.toFixed(5)}.`);
  process.exitCode=1;
});
