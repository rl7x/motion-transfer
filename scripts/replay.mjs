import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReplayRuntime } from '../runtime/replay.mjs';
import { replayTrace } from '../runtime/trace.mjs';

async function main() {
  const root = new URL('../', import.meta.url);
  const output = resolve(process.argv[3] ?? fileURLToPath(new URL('reports/dashy-dango-replay.json', root)));
  await mkdir(dirname(output), { recursive: true });
  const report = { schemaVersion: 1, runs: [], verified: false };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  try {
    const tracePath = process.argv[2] ? resolve(process.argv[2]) : new URL('experiments/dashy-dango/start-move-dash.json', root);
    const traceBytes = await readFile(tracePath);
    const trace = JSON.parse(traceBytes);
    if (trace.target !== 'dashy-dango') throw new Error('Only the registered dashy-dango target is supported');
    const manifest = JSON.parse(await readFile(new URL('targets/dashy-dango/target.lock.json', root), 'utf8'));
    const cartridge = await readFile(new URL('targets/dashy-dango/cart.wasm', root));
    const hash = createHash('sha256').update(cartridge).digest('hex');
    if (hash !== manifest.integrity.digest || cartridge.length !== manifest.integrity.bytes) {
      throw new Error('Target cartridge does not match target.lock.json');
    }
    const runtime = await createReplayRuntime(cartridge);
    Object.assign(report, {
      target: trace.target,
      traceSha256: createHash('sha256').update(traceBytes).digest('hex'),
      provenance: runtime.provenance,
      trace,
    });
    for (let run = 1; run <= 3; run++) {
      const result = replayTrace(runtime, trace);
      report.runs.push(result);
      if (run > 1) deepStrictEqual(result, report.runs[0], `Replay ${run} differs from replay 1`);
      console.log(`Replay ${run}: ${result.frames.length} frames, ${result.checkpoints.length} checkpoints`);
    }
    report.verified = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log('All three replays match at every frame and checkpoint.');
  console.log(`Observations saved to ${output}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
