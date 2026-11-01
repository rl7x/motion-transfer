import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { digest } from '../../component/build.mjs';

const require=createRequire(import.meta.url);
export async function loadRoadster(){
  const root=new URL('./',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('recipient.lock.json',root),'utf8'));
  const files={};
  for(const [path,sha]of Object.entries(manifest.files)){
    if(path.includes('..')||path.startsWith('/'))throw Error('Invalid recipient path');
    const bytes=await readFile(new URL('upstream/'+path,root));
    if(digest(bytes)!==sha)throw Error('Roadster recipient integrity mismatch: '+path);
    files[path]=bytes;
  }
  const threeRoot=dirname(dirname(require.resolve('three')));
  const metadata=JSON.parse(await readFile(join(threeRoot,'package.json'),'utf8'));
  if(metadata.version!=='0.186.1')throw Error('Expected three@0.186.1');
  return {manifest,files,notices:files.LICENSE.toString()+'\n\n'+await readFile(join(threeRoot,'LICENSE'),'utf8')};
}
