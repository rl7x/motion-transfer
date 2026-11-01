import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileMotion, digest } from './build.mjs';

export async function writeMotionPackage(directory, report, evidence) {
  const attempt = report.attempts.find(item => item.attempt === report.acceptedAttempt);
  if (report.status !== 'accepted' || !attempt?.development?.passed || !attempt?.acceptance?.passed) throw new Error('Only evaluated candidates can be packaged');
  if (evidence.sha256 !== report.evidenceSha256 || evidence.cartridgeSha256 !== report.cartridgeSha256) throw new Error('Package evidence does not match the evaluated recovery');
  const compiled = await compileMotion(attempt.candidate.source);
  if ([attempt.sourceSha256, attempt.development.sourceSha256, attempt.acceptance.sourceSha256].some(hash => hash !== compiled.sourceSha256)
    || [attempt.development.javascriptSha256, attempt.acceptance.javascriptSha256].some(hash => hash !== compiled.javascriptSha256)) {
    throw new Error('Package source/build does not match the evaluated candidate');
  }
  const contract = {
    ...attempt.candidate.contract,
    interfaceVersion: 1, tickRate: 60, units: 'source-pixels-per-tick',
    numericDomain: 'sourceBodyWidth=8; default donor configuration; tested button masks',
  };
  const id = digest(JSON.stringify({ source: compiled.sourceSha256, javascript: compiled.javascriptSha256, contract }));
  await mkdir(directory);
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const files = {
    'component.ts': attempt.candidate.source,
    'component.js': compiled.javascript,
    'contract.json': json(contract),
    'package.json': json({ name: 'recovered-dash-motion', version: '0.1.0', private: true, type: 'module', exports: './component.js' }),
    'evaluation-development.json': json(attempt.development),
    'evaluation-acceptance.json': json({ ...attempt.acceptance, seed: report.acceptanceSeed }),
    ...(attempt.regressions ? { 'evaluation-regressions.json': json(attempt.regressions) } : {}),
    'recovery-history.json': json(report),
    'provenance.json': json({
      schemaVersion: 1, id, sourceSha256: compiled.sourceSha256, javascriptSha256: compiled.javascriptSha256,
      cartridgeSha256: report.cartridgeSha256, evidenceSha256: report.evidenceSha256,
      model: report.model, models: [...new Set(report.requests?.map(request => request.model ?? report.model) ?? [report.model])],
      responseId: attempt.responseId, estimatedCostUsd: report.estimatedCostUsd,
      humanAssistance: report.humanAssistance, implementationAuthor: 'Meta models; no manual source repairs',
      buildTool: 'esbuild 0.28.2', evaluationScope: 'Finite motion rollouts; combat, scoring, visuals, and recipient integration excluded',
    }),
    'evidence.json': json(evidence),
  };
  for (const [name, contents] of Object.entries(files)) await writeFile(join(directory, name), contents);
  return { id, sourceSha256: compiled.sourceSha256 };
}
