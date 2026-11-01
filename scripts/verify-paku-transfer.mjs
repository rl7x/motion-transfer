import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileAdapter } from '../transfer/adapter.mjs';
import { checkPakuGeneration, loadPakuTransfer, savePakuTransfer } from '../transfer/saved-paku.mjs';
import { pakuEnvironment } from '../transfer/paku-environment.mjs';
import { evaluatePakuAdapter } from '../evaluator/paku-adapter.mjs';
import { verifyPakuBrowser } from '../evaluator/paku-browser.mjs';

async function main() {
  const args = process.argv.slice(2);
  let directory, save = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--save') save = true;
    else if (args[index] === '--candidate' && args[index + 1] && !directory) directory = pathToFileURL(resolve(args[++index]) + '/');
    else throw Error('Usage: npm run verify:transfer -- [--candidate <run-directory> [--save]]');
  }
  if (save && !directory) throw Error('--save requires --candidate; saved artifacts are immutable');
  let candidate;
  if (directory) {
    const source = await readFile(new URL('adapter.ts', directory), 'utf8');
    const javascript = await readFile(new URL('adapter.js', directory), 'utf8');
    const generation = JSON.parse(await readFile(new URL('generation.json', directory), 'utf8'));
    const evidence = JSON.parse(await readFile(new URL('evidence.json', directory), 'utf8'));
    candidate = { source, javascript, generation, evidence };
  } else candidate = await loadPakuTransfer();
  checkPakuGeneration(candidate, await pakuEnvironment());
  const compiled = await compileAdapter(candidate.source);
  if (compiled.javascript !== candidate.javascript) throw Error('Saved JavaScript does not match the compiled Meta source');
  const conformance = await evaluatePakuAdapter(candidate.source);
  if (!conformance.passed) throw Error('Adapter conformance failed');
  const browser = await verifyPakuBrowser(compiled, { onProgress: console.log });
  const output = new URL('../reports/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('paku-transfer-verification.json', output), JSON.stringify({
    passed: conformance.passed && browser.passed, metaCalled: false, conformance, browser,
  }, null, 2) + '\n');
  if (directory) {
    await writeFile(new URL('conformance.json', directory), JSON.stringify(conformance, null, 2) + '\n');
    await writeFile(new URL('browser.json', directory), JSON.stringify(browser, null, 2) + '\n');
  }
  if (!browser.passed) throw Error('Playable integration failed; see reports/paku-transfer-verification.json');
  if (save) {
    const receipt = await savePakuTransfer({ ...candidate, conformance, browser });
    console.log(`Saved verified transfer: ${receipt.id}`);
  }
  console.log(`PAKU PAKU transfer verified: ${conformance.results.length} conformance cases, ${browser.results.length} browser checks. No Meta API requests made.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
