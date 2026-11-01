import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../component/build.mjs';
import {writeMotionPackage} from '../component/package.mjs';

export async function saveInvestigationEvidence(directory,session,report={}){
  if(!session)return;
  if(!/^[a-f0-9-]{36}$/.test(session.id))throw Error('Invalid evidence session identity');
  const root=join(directory,'sessions',session.id);await mkdir(root,{recursive:true});
  for(const capture of session.captures??[]){
    if(!/^[a-f0-9]{64}$/.test(capture.pngSha256)||!capture.dataUrl?.startsWith('data:image/png;base64,'))throw Error('Invalid framebuffer evidence');
    const bytes=Buffer.from(capture.dataUrl.split(',')[1],'base64');if(digest(bytes)!==capture.pngSha256)throw Error('Framebuffer evidence hash mismatch');
    const path=join(root,capture.pngSha256+'.png');
    try{await writeFile(path,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||digest(await readFile(path))!==capture.pngSha256)throw error;}
  }
  const recovery=session.recovery;
  if(recovery?.acceptedAttempt){
    const entry=recovery.attempts.find(item=>item.attempt===recovery.acceptedAttempt),selection=recovery.selections.find(item=>item.id===entry?.selectionId);
    if(!entry?.acceptance?.passed||recovery.frozenCandidateId!==entry.candidateId||!selection)throw Error('Component publication requires separate frozen acceptance');
    const parent=join(root,'components');await mkdir(parent,{recursive:true});
    const path=join(parent,entry.candidateId);
    try{
      await writeMotionPackage(path,{schemaVersion:1,status:'accepted',acceptedAttempt:entry.attempt,attempts:recovery.attempts,acceptanceSeed:recovery.acceptanceSeed,
        evidenceSha256:selection.evidence.sha256,cartridgeSha256:session.identity.cartridgeSha256,model:report.model??'injected-local-fixture',requests:report.requests??[],estimatedCostUsd:report.estimatedCostUsd??0,humanAssistance:selection.evidence.humanAssistance,investigationSessionId:session.id},selection.evidence);
    }catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(await readFile(join(path,'provenance.json'),'utf8'));if(prior.sourceSha256!==entry.sourceSha256)throw Error('Stored component identity mismatch');}
  }
  const path=join(root,'journal.json'),temporary=path+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(session,null,2)+'\n',{mode:0o600});await rename(temporary,path);
}
