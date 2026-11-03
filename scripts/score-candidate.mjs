import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { freezeFidelityStudy, resolveCandidatePaths, scoreFidelityStudy } from '../benchmark/fidelity.mjs';

try {
  const { values } = parseArgs({ options: { freeze: { type: 'string' }, out: { type: 'string' }, score: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('npm run score:candidate -- --freeze candidates.json --out <new-study-directory>');
    console.log('npm run score:candidate -- --score <frozen-study-directory>');
    console.log('Input: {"candidates":[{"id":"saved","condition":"saved-recovery","sourcePath":"component.ts","configPath":"contract.json"}]}');
    console.log('Paths are relative to the input JSON. Freeze all conditions together before scoring. No API calls. Results cannot be overwritten.');
  } else if (values.freeze && values.out && !values.score) {
    const path = resolve(values.freeze);
    const input = JSON.parse(await readFile(path, 'utf8'));
    const study = await freezeFidelityStudy(resolve(values.out), resolveCandidatePaths(input.candidates, dirname(path)));
    console.log(`Frozen ${study.candidates.length} candidates; study ${study.id}; reserved seed ${study.seed}.`);
  } else if (values.score && !values.freeze && !values.out) {
    const report = await scoreFidelityStudy(resolve(values.score));
    for (const result of report.results) console.log(`${result.id} (${result.condition}): ${result.passed}/${result.total}; ${result.status === 'scored' ? `maximum error ${result.maxPositionError} source pixels` : result.error}`);
    console.log('All outcomes retained. This is finite fidelity evidence, not recovery acceptance. No API calls.');
  } else throw new Error('Use --freeze <candidates.json> --out <new-directory>, or --score <directory>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
