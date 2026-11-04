import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { readUsage, tokenCost } from '../src/agent/accounting.mjs';
import { createOpenClient, OPEN_MODEL, OPEN_MODEL_NAME, OPEN_PRICE } from '../src/agent/open-client.mjs';
import { ledgerSam } from '../src/footage/cloud-sam.mjs';
import { checkClipPath, checkRights, recoverMove, RIGHTS } from '../src/footage/recover.mjs';
import { callSam, samCostUsd, samRequest, textFromStream } from '../src/footage/sam.mjs';

const USAGE = `Recover a dash-like move from a gameplay clip, with no source code and no binary.

  npm run recover -- <clip.mp4> --rights <basis> --source "<game and author>" --player <frame:x,y> --allow-paid [--out <directory>]

  <clip.mp4>          A local 60 fps clip showing the move at least twice. Web links are refused.
  --rights <basis>    ${Object.keys(RIGHTS).join(', ')}
  --source <text>     What the game is and who made it, so the result can credit it
  --player <f:x,y>    A point on the player: frame number, then its pixel position in that frame
  --pixel-scale <n>   For pixel art, how many video pixels make one game pixel. Defaults to 1
  --from, --to <n>    Use only these frames, for example to skip a title screen
  --out <directory>   Where the result goes. Defaults to ./recovered-move
  --allow-paid        Confirms this uses your MODEL_API_KEY for SAM 3.1 and BASETEN_API_KEY for ${OPEN_MODEL_NAME}

It keeps only motion numbers and generated code, never the clip's frames, art or sound.
The result is a footage match. It shows how the move travels, not the game's hidden rules.
Use it with: npm run port -- <game> --core <file> --component <directory> --open --allow-paid`;

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  rights: { type: 'string' }, source: { type: 'string' }, player: { type: 'string' }, 'pixel-scale': { type: 'string', default: '1' },
  from: { type: 'string', default: '0' }, to: { type: 'string' }, out: { type: 'string', default: './recovered-move' },
  'allow-paid': { type: 'boolean' }, help: { type: 'boolean' },
} });
const [clip] = positionals;
if (values.help || !clip) { console.log(USAGE); process.exit(0); }

function directSam() {
  if (!process.env.MODEL_API_KEY) throw Error('Set MODEL_API_KEY, or add it to .env');
  return async ({ video, prompt, frames }) => ({
    text: textFromStream(await callSam(process.env.MODEL_API_KEY, samRequest({ video, prompt }))), estimatedCostUsd: samCostUsd(frames),
  });
}

function parsePlayer(text) {
  const match = text?.match(/^(\d+):(\d+),(\d+)$/);
  if (!match) throw Error('--player must look like 14:322,322, meaning frame 14 at x 322, y 322');
  return { frame: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

try {
  checkRights(values);
  checkClipPath(clip);
  const point = parsePlayer(values.player);
  if (!values['allow-paid']) throw Error('Pass --allow-paid to confirm this sends the clip to Meta and measurements to Baseten.');
  if (existsSync('.env')) loadEnvFile('.env');
  const client = createOpenClient(process.env.BASETEN_API_KEY);
  // The marker means this checkout's Meta spending belongs to the cloud ledger.
  const sam = existsSync('.vercel/remote-generation.json') ? await ledgerSam() : directSam();
  const generate = async request => {
    const response = await client.respond(request);
    return { response, estimatedCostUsd: tokenCost(readUsage(response.usage), OPEN_PRICE) };
  };
  const result = await recoverMove({
    clip, out: resolve(values.out), rights: values.rights, source: values.source, sam, generate,
    model: OPEN_MODEL, modelName: OPEN_MODEL_NAME, log: line => console.log(line),
    player: { x: point.x, y: point.y }, from: point.frame + Number(values.from), to: values.to ? Number(values.to) : null, pixelScale: Number(values['pixel-scale']),
  });
  console.log(`\n${OPEN_MODEL_NAME}: ${result.submission.summary}`);
  console.log(`Saved to ${result.out}. Label: footage match. Cost: $${result.report.estimatedCostUsd.total.toFixed(4)} estimated.`);
  console.log('Checked: duration, distance and direction on bursts the model never saw, and the recharge timing.');
  console.log('Not checked: hidden rules, what the button does, or anything the clip does not show.');
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
