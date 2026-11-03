import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { digest } from '../../component/build.mjs';

const require = createRequire(import.meta.url);
export async function loadPakuPaku() {
  const directory = new URL('../../../assets/recipients/paku-paku/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('recipient.lock.json', directory), 'utf8'));
  const files = {};
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(file.local, directory));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Recipient integrity mismatch: ${file.local}`);
    files[file.local] = bytes.toString('utf8');
  }
  const dependencies = {};
  for (const dependency of [manifest.runtime, manifest.sound]) {
    const packagePath = require.resolve(`${dependency.name}/package.json`);
    const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
    if (metadata.version !== dependency.version) throw new Error(`Expected ${dependency.name}@${dependency.version}`);
    dependencies[dependency.name] = dirname(packagePath);
  }
  return {
    manifest, source: files['upstream/main.js'],
    runtime: await readFile(join(dependencies['crisp-game-lib'], 'docs/bundle.js'), 'utf8'),
    sound: await readFile(join(dependencies['sounds-some-sounds'], 'build/index.js'), 'utf8'),
    licenses: [files['upstream/LICENSE.txt'],
      await readFile(join(dependencies['crisp-game-lib'], 'LICENSE.txt'), 'utf8'),
      await readFile(join(dependencies['sounds-some-sounds'], 'LICENSE.txt'), 'utf8')],
  };
}
