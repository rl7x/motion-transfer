import { createHash } from 'node:crypto';
import { build, transform } from 'esbuild';

export const digest = text => createHash('sha256').update(text).digest('hex');

export async function compileMotion(source) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 16_384) {
    throw new Error('Component source must contain 1–16 KB of TypeScript');
  }
  const result = await build({
    stdin: { contents: source, sourcefile: 'component.ts', loader: 'ts' },
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    write: false, metafile: true, logLevel: 'silent',
    plugins: [{ name: 'standalone-component', setup(builder) {
      builder.onResolve({ filter: /.*/ }, () => ({ errors: [{ text: 'Component imports are not allowed' }] }));
    } }],
  });
  const esm = result.outputFiles[0].text;
  const exports = Object.values(result.metafile.outputs).flatMap(output => output.exports);
  if (!exports.includes('init') || !exports.includes('step')) {
    throw new Error('Component must export named ES module functions init and step; use export function init(config) and export function step(state,input,config)');
  }
  const compiled = await transform(esm, { format: 'iife', globalName: 'candidate', target: 'es2022' });
  return { sourceSha256: digest(source), javascriptSha256: digest(esm), javascript: esm, code: compiled.code };
}
