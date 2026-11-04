import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { AUTO_PORT } from './request.mjs';

/** For this project's own checkout: spend only where the authoritative cloud ledger lives. */
export async function ledgerGenerator(game) {
  loadEnvFile('.env.local');
  const { Sandbox } = await import('../hosting/vercel/sdk.mjs');
  const { name } = JSON.parse(await readFile('reports/vercel-deployment/backend-state.json', 'utf8'));
  const sandbox = await Sandbox.get({ name, resume: true });
  await sandbox.writeFiles([{ path: '/app/scripts/auto-port-generate.mjs', content: await readFile('scripts/auto-port-generate.mjs') }]);
  return async (request, attempt) => {
    const id = `port-command-${game}-${attempt}-${randomUUID()}`;
    const input = `/tmp/${id}.json`, output = `/tmp/${id}-out.json`;
    await sandbox.writeFiles([{ path: input, content: Buffer.from(JSON.stringify({ id, game, attempt, maxCostUsd: AUTO_PORT.maxAttemptCostUsd, request })) }]);
    const run = await sandbox.runCommand({ cmd: 'node', args: ['scripts/auto-port-generate.mjs', input, output], cwd: '/app' });
    if (run.exitCode !== 0) throw Error(`Generation failed: ${(await run.stderr()).slice(-500)}`);
    return JSON.parse((await sandbox.readFileToBuffer({ path: output })).toString('utf8'));
  };
}
