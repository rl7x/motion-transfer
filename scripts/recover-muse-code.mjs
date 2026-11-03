import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRecoveryProtocol } from '../src/agent/recovery-protocol.mjs';
import { prepareMusePaidRun } from '../src/mcp/control.mjs';
import { runEchoPreflight } from '../src/mcp/preflight.mjs';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    preflight: { type: 'boolean' }, paid: { type: 'boolean' }, out: { type: 'string' },
    'phase-ledger': { type: 'string' }, 'muse-binary': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/recover-muse-code.mjs [--preflight] --out <directory> --phase-ledger <directory> [--muse-binary <path>]');
    console.log('node scripts/recover-muse-code.mjs --paid --phase-ledger <directory>');
    console.log('The default action is an unpaid echo preflight. It does not grant a Muse session a trusted turn, and it does not make tools/call operational.');
    console.log('--paid refuses before any Muse process and before creating or reserving a phase ledger.');
    console.log('Preflight fails clearly if the pinned Muse binary or macOS sandbox-exec is unavailable. A missing phase ledger is not created.');
    return 0;
  }
  if (values.paid) {
    if (!values['phase-ledger']) throw Error('--phase-ledger is required');
    await prepareMusePaidRun({
      phaseBudget: { async reserve() { throw Error('Paid Muse run refused before a ledger reservation'); } },
      protocol: createRecoveryProtocol(),
    });
    throw Error('Paid Muse run refused');
  }
  if (!values.out || !values['phase-ledger']) throw Error('--out and --phase-ledger are required');
  const result = await runEchoPreflight({
    binary: values['muse-binary'], out: resolve(values.out), phaseLedger: resolve(values['phase-ledger']),
  });
  console.log(JSON.stringify({ kind: result.kind, paidRun: result.paidRun, accepted: result.accepted, recoveryRate: result.recoveryRate }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
