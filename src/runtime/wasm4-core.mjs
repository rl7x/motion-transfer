import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let corePromise;

export function loadWasm4Core() {
  corePromise ??= load();
  return corePromise;
}

async function load() {
  const packagePath = require.resolve('wasm4/package.json');
  const { version } = JSON.parse(await readFile(packagePath, 'utf8'));
  if (version !== '2.7.1') {
    throw new Error(`Expected WASM-4 2.7.1, received ${version}`);
  }

  const map = JSON.parse(await readFile(join(dirname(packagePath),
    'assets/runtime/developer-build/wasm4.js.map'), 'utf8'));
  const sources = {};
  for (const name of ['constants', 'framebuffer']) {
    const index = map.sources.findIndex(path => path.endsWith(`/src/${name}.ts`));
    const contents = map.sourcesContent[index];
    if (typeof contents !== 'string') {
      throw new Error(`WASM-4 source map is missing ${name}.ts`);
    }
    sources[name] = contents;
  }

  const result = await build({
    stdin: {
      contents: 'export * from "./constants"; export { Framebuffer } from "./framebuffer";',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    define: { WASM4_GAMEDEV_MODE: 'false' },
    plugins: [{
      name: 'installed-wasm4-sources',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(constants|framebuffer)$/ }, args => ({
          path: args.path.slice(2), namespace: 'wasm4',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'wasm4' }, args => ({
          contents: sources[args.path], loader: 'ts',
        }));
      },
    }],
  });
  const encoded = Buffer.from(result.outputFiles[0].contents).toString('base64');
  const core = await import(`data:text/javascript;base64,${encoded}`);
  return {
    ...core,
    provenance: {
      name: 'wasm4',
      version,
      sources: Object.fromEntries(Object.entries(sources).map(([name, contents]) => [
        `${name}.ts`, createHash('sha256').update(contents).digest('hex'),
      ])),
    },
  };
}
