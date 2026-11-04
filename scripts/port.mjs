import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { PRICES, readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { createMetaClient } from '../src/agent/meta-client.mjs';
import { createOpenClient, OPEN_MODEL_NAME, OPEN_PRICE } from '../src/agent/open-client.mjs';
import { ledgerGenerator } from '../src/auto-port/ledger-generate.mjs';
import { CHECKED, NOT_CHECKED, portGame, revision } from '../src/auto-port/port-game.mjs';
import { AUTO_PORT } from '../src/auto-port/request.mjs';
import { loadRecoveredMove } from '../src/footage/component.mjs';

const USAGE = `Add the recovered dash to your own browser game.

  npm run port -- <game-directory> --core <file> --allow-paid [--out <directory>] [--key KeyX]
  npm run port -- <game-directory> --core <file> --allow-paid --out <new-directory> --revise <previous-port> --note "what went wrong"

  <game-directory>  A game that runs from a static index.html with a canvas
  --core <file>     The file that moves the player, relative to the game directory
  --allow-paid      Confirms this sends that file to Meta on your MODEL_API_KEY
  --out <directory> Where the patched copy goes. Defaults to <game-directory>-dash
  --key <code>      The dash key, as a KeyboardEvent.code. Defaults to KeyX
  --revise <dir>    A previous port to send back to Muse Spark, with --note
  --note <text>     What you found when you played it
  --open            Use ${OPEN_MODEL_NAME}, Meta's open-weight model, on your BASETEN_API_KEY
  --component <dir> Port a move from npm run recover instead of the recovered dash

Each attempt is capped at $${AUTO_PORT.maxAttemptCostUsd.toFixed(2)}, with at most ${AUTO_PORT.maxAttempts} attempts. Your original game is not changed.`;

/** One paid request on the caller's key, refused before sending if it could pass the ceiling. */
function directGenerator() {
  if (existsSync('.env')) loadEnvFile('.env');
  if (!process.env.MODEL_API_KEY) throw Error('Set MODEL_API_KEY, or add it to .env');
  const client = createMetaClient(process.env.MODEL_API_KEY, { requestTimeoutMs: 170_000 });
  return async request => {
    const price = PRICES[request.model];
    const ceiling = ((await client.countInputTokens(request)) * price.input + request.max_output_tokens * price.output) / 1e6;
    if (ceiling > AUTO_PORT.maxAttemptCostUsd) throw Error(`This file could cost $${ceiling.toFixed(4)} per attempt, above the $${AUTO_PORT.maxAttemptCostUsd} ceiling. Nothing was sent.`);
    const response = await client.respond(request);
    return { response, estimatedCostUsd: tokenCost(readUsage(response.usage), price) };
  };
}

/** One request to the open-weight model on Baseten. */
function openGenerator() {
  if (existsSync('.env')) loadEnvFile('.env');
  const client = createOpenClient(process.env.BASETEN_API_KEY);
  return async request => {
    const response = await client.respond(request);
    return { response, estimatedCostUsd: tokenCost(readUsage(response.usage), OPEN_PRICE) };
  };
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  open: { type: 'boolean' }, component: { type: 'string' }, core: { type: 'string' }, out: { type: 'string' }, key: { type: 'string', default: 'KeyX' }, revise: { type: 'string' }, note: { type: 'string' }, 'allow-paid': { type: 'boolean' }, help: { type: 'boolean' },
} });
const [directory] = positionals;
if (values.help || !directory) { console.log(USAGE); process.exit(0); }
if (!values.core || !values['allow-paid'] || Boolean(values.revise) !== Boolean(values.note)) { console.error(USAGE); process.exit(1); }

try {
  // The marker means this checkout's spending belongs to the cloud ledger, so it must not start a second allowance.
  const cloud = !values.open && existsSync('.vercel/remote-generation.json');
  const generate = values.open ? openGenerator() : cloud ? await ledgerGenerator(basename(resolve(directory))) : directGenerator();
  const model = values.open ? OPEN_MODEL_NAME : 'Muse Spark';
  const move = values.component ? await loadRecoveredMove(values.component) : null;
  const previous = values.revise ? JSON.parse(await readFile(join(values.revise, 'motion-port.json'), 'utf8')).attempts.at(-1) : null;
  const report = await portGame({ directory, core: values.core, dashKey: values.key, ...(values.out ? { out: values.out } : {}), model, ...(move ? { component: move.component, guidance: move.guidance } : {}), revise: previous && revision(previous, values.note), generate, log: console.log });
  const last = report.attempts[report.attempts.length - 1];
  console.log(`\n${model}: ${last.summary}`);
  console.log(`Patched copy: ${report.out}`);
  console.log(`Cost: $${report.estimatedCostUsd.toFixed(4)} estimated over ${report.attempts.length} attempt${report.attempts.length === 1 ? '' : 's'}${cloud ? ', recorded in the cloud ledger' : ''}`);
  console.log(`Play it from any static web server, then hold ${values.key.replace('Key', '')} to dash.`);
  console.log(`\nChecked:\n${CHECKED.map(line => `  - ${line}`).join('\n')}`);
  console.log(`\nNot checked, so test these yourself:\n${NOT_CHECKED.map(line => `  - ${line}`).join('\n')}`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
