import { loadEnvFile } from 'node:process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { investigate, DEFAULT_QUESTION } from '../src/agent/investigate.mjs';

async function main() {
  const { values, positionals } = parseArgs({
    options: { out: { type: 'string' }, resume: { type: 'string' }, help: { type: 'boolean' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('npm run investigate -- ["question"] [--out reports/investigation.json]');
    console.log('Reads MODEL_API_KEY and optional META_MODEL from your environment or .env.');
    console.log('Limits: $0.50 estimated budget, 6 model requests, 12 tools, 180 seconds.');
    console.log('Use --resume reports/run.json to continue settled evidence within the original cost/call budget.');
    return;
  }
  try {
    loadEnvFile(resolve('.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not load .env');
  }
  if (!process.env.MODEL_API_KEY?.trim()) {
    throw new Error('MODEL_API_KEY is not set. Copy .env.example to .env and add your Meta API key locally.');
  }
  if (positionals.length > 1) throw new Error('Pass the question as one quoted argument');
  const resumeReport = values.resume ? JSON.parse(await readFile(resolve(values.resume), 'utf8')) : undefined;
  const question = positionals[0] ?? resumeReport?.question ?? DEFAULT_QUESTION;
  const model = process.env.META_MODEL?.trim() || 'muse-wonder-1.0';
  const output = resolve(values.out ?? values.resume ?? `reports/investigations/${randomUUID()}.json`);
  await mkdir(dirname(output), { recursive: true });
  const save = async report => {
    await writeFile(`${output}.tmp`, JSON.stringify(report, null, 2) + '\n');
    await rename(`${output}.tmp`, output);
  };
  console.log(`Model: ${model}. Maximum estimated generation spend: $0.50.`);
  console.log(`Report: ${output}`);
  try {
    const report = await investigate({
      apiKey: process.env.MODEL_API_KEY, model, question, resumeReport,
      onUpdate: save,
      onProgress: message => console.log(message),
    });
    console.log('\n' + report.conclusion);
    console.log(`\nEstimated token cost: $${report.estimatedCostUsd.toFixed(4)}. Conclusion requires human review.`);
  } catch (error) {
    if (error.report) {
      console.error(`Estimated accounted cost: $${error.report.estimatedCostUsd.toFixed(4)}; unsettled reservation: $${error.report.reservedCostUsd.toFixed(4)}.`);
    }
    throw error;
  }
}

main().catch(error => {
  const key = process.env.MODEL_API_KEY;
  console.error(key ? error.message.replaceAll(key, '[redacted]') : error.message);
  process.exitCode = 1;
});
