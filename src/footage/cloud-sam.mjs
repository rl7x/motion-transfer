import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { samRequest } from './sam.mjs';

/** For this project's own checkout: spend only where the authoritative cloud ledger lives. */
export async function ledgerSam() {
  loadEnvFile('.env.local');
  const { Sandbox } = await import('../hosting/vercel/sdk.mjs');
  const { name } = JSON.parse(await readFile('reports/vercel-deployment/backend-state.json', 'utf8'));
  const sandbox = await Sandbox.get({ name, resume: true });
  await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', 'src/footage'], cwd: '/app' });
  await sandbox.writeFiles([
    { path: '/app/scripts/sam-generate.mjs', content: await readFile('scripts/sam-generate.mjs') },
    { path: '/app/src/footage/sam.mjs', content: await readFile('src/footage/sam.mjs') },
  ]);
  return async ({ video, prompt, frames }) => {
    const id = `footage-sam-${randomUUID()}`;
    const input = `/tmp/${id}.json`, output = `/tmp/${id}-out.json`;
    await sandbox.writeFiles([{ path: input, content: Buffer.from(JSON.stringify({ id, frames, request: samRequest({ video, prompt }) })) }]);
    const run = await sandbox.runCommand({ cmd: 'node', args: ['scripts/sam-generate.mjs', input, output], cwd: '/app' });
    if (run.exitCode !== 0) throw Error(`SAM failed: ${(await run.stderr()).slice(-600)}`);
    return JSON.parse((await sandbox.readFileToBuffer({ path: output })).toString('utf8'));
  };
}
