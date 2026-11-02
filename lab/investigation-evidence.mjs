import {mkdir,writeFile,rename,readFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../component/build.mjs';
import {writeMotionPackage} from '../component/package.mjs';

async function verifyPublishedComponent(path,entry){
  const {id,...receipt}=JSON.parse(await readFile(join(path,'publication.json'),'utf8'));
  if(receipt.candidateId!==entry.candidateId||digest(JSON.stringify(receipt))!==id)throw Error('Stored component publication identity mismatch');
  const names=Object.keys(receipt.files);
  if(!names.every(name=>/^[a-z][a-z0-9.-]+$/.test(name))||JSON.stringify((await readdir(path)).sort())!==JSON.stringify([...names,'publication.json'].sort()))throw Error('Stored component file set mismatch');
  for(const name of names)if(digest(await readFile(join(path,name)))!==receipt.files[name])throw Error('Stored component integrity mismatch: '+name);
  if(receipt.files['component.ts']!==entry.sourceSha256)throw Error('Stored component source identity mismatch');
}

async function publishComponent(parent,entry,report,evidence){
  const path=join(parent,entry.candidateId);
  try{await stat(path);await verifyPublishedComponent(path,entry);return;}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{
    const component=await writeMotionPackage(temporary,report,evidence),names=(await readdir(temporary)).sort();
    const files=Object.fromEntries(await Promise.all(names.map(async name=>[name,digest(await readFile(join(temporary,name)))])));
    const receipt={candidateId:entry.candidateId,componentId:component.id,files};
    await writeFile(join(temporary,'publication.json'),JSON.stringify({id:digest(JSON.stringify(receipt)),...receipt},null,2)+'\n');
    await rename(temporary,path);await verifyPublishedComponent(path,entry);
  }finally{await rm(temporary,{recursive:true,force:true});}
}

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
  if(session.experimentWorkbench){
    const experiments=join(root,'experiments');await mkdir(experiments,{recursive:true});
    for(const artifact of session.experimentWorkbench.artifacts){
      const bytes=JSON.stringify(artifact.payload);
      if(!/^[a-f0-9]{64}$/.test(artifact.id)||digest(bytes)!==artifact.id)throw Error('Experiment evidence integrity mismatch');
      const path=join(experiments,artifact.id+'.json');
      try{await writeFile(path,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||digest(await readFile(path))!==artifact.id)throw error;}
      for(const capture of artifact.payload.captures??[]){
        const png=Buffer.from(capture.dataUrl.split(',')[1],'base64');if(!/^[a-f0-9]{64}$/.test(capture.pngSha256)||digest(png)!==capture.pngSha256)throw Error('Experiment image integrity mismatch');
        const imagePath=join(root,capture.pngSha256+'.png');
        try{await writeFile(imagePath,png,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||digest(await readFile(imagePath))!==capture.pngSha256)throw error;}
      }
    }
  }
  const recovery=session.recovery;
  if(recovery?.acceptedAttempt){
    const entry=recovery.attempts.find(item=>item.attempt===recovery.acceptedAttempt),selection=recovery.selections.find(item=>item.id===entry?.selectionId);
    if(!entry?.acceptance?.passed||recovery.frozenCandidateId!==entry.candidateId||!selection)throw Error('Component publication requires separate frozen acceptance');
    if(!/^[a-f0-9]{64}$/.test(entry.candidateId)||entry.candidateId!==digest(JSON.stringify({candidate:entry.candidate,timerFields:entry.timerFields})))throw Error('Component publication identity mismatch');
    const parent=join(root,'components');await mkdir(parent,{recursive:true});
    await publishComponent(parent,entry,{schemaVersion:1,status:'accepted',acceptedAttempt:entry.attempt,attempts:recovery.attempts,acceptanceSeed:recovery.acceptanceSeed,
        evidenceSha256:selection.evidence.sha256,cartridgeSha256:session.identity.cartridgeSha256,model:report.model??'injected-local-fixture',requests:report.requests??[],estimatedCostUsd:report.estimatedCostUsd??0,humanAssistance:selection.evidence.humanAssistance,investigationSessionId:session.id},selection.evidence);
  }
  const path=join(root,'journal.json'),temporary=path+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(session,null,2)+'\n',{mode:0o600});await rename(temporary,path);
}
