import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { probeIntegration } from '../src/integration/probe.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    scale: { type: 'string', default: '0.1' }, activation: { type: 'string', default: 'held' },
    direction: { type: 'string', default: 'facing' }, gate: { type: 'string', default: 'airborne' },
    out: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run probe:integration -- adapter.ts [--scale 0.1] [--activation held|press] [--direction facing|opposite] [--gate airborne|always] [--out new-report.json]');
    console.log('Checks the horizontal adapter contract using the saved recovered component. No API calls. It does not verify your surrounding game loop.');
  } else {
    if (positionals.length !== 1) throw Error('Supply one adapter source path; see --help');
    const report = await probeIntegration(await readFile(positionals[0], 'utf8'), { unitScale: Number(values.scale),
      activation: values.activation, direction: values.direction, activationGate: values.gate });
    if (values.out) await writeFile(values.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    for (const result of report.results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`);
    console.log(report.scope);
    if (!report.passed) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
