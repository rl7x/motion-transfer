import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../component/build.mjs';

export async function saveInvestigationEvidence(directory,session){
  if(!session)return;
  if(!/^[a-f0-9-]{36}$/.test(session.id))throw Error('Invalid evidence session identity');
  const root=join(directory,'sessions',session.id);await mkdir(root,{recursive:true});
  for(const capture of session.captures??[]){
    if(!/^[a-f0-9]{64}$/.test(capture.pngSha256)||!capture.dataUrl?.startsWith('data:image/png;base64,'))throw Error('Invalid framebuffer evidence');
    const bytes=Buffer.from(capture.dataUrl.split(',')[1],'base64');if(digest(bytes)!==capture.pngSha256)throw Error('Framebuffer evidence hash mismatch');
    const path=join(root,capture.pngSha256+'.png');
    try{await writeFile(path,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||digest(await readFile(path))!==capture.pngSha256)throw error;}
  }
  const path=join(root,'journal.json'),temporary=path+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(session,null,2)+'\n',{mode:0o600});await rename(temporary,path);
}
