import { mkdir, writeFile, rename } from 'node:fs/promises';
import { verifySavedMotion } from '../evaluator/saved-motion.mjs';

const directory = new URL('../reports/', import.meta.url);
const output = new URL('recovered-motion-verification.json', directory);

async function save(report) {
  const temporary = new URL('recovered-motion-verification.json.tmp', directory);
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
  await rename(temporary, output);
}

async function main() {
  await mkdir(directory, { recursive: true });
  try {
    const report = await verifySavedMotion();
    await save(report);
    console.log(`Recovered motion verified: ${report.cases} traces, ${report.ticks} ticks, maximum position error ${report.maxPositionError}.`);
    console.log('Exact motion-ownership and dash-event timing passed. No Meta API requests made.');
    console.log('These are replays of frozen evaluation inputs, not a new held-out claim.');
  } catch (error) {
    await save({ status: 'failed', metaCalled: false, error: error.message });
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
