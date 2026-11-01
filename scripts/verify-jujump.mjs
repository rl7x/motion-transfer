import { mkdir,writeFile,rename } from 'node:fs/promises';
import { loadJujumpAdapter,jujumpEnvironment } from '../transfer/jujump.mjs';
import { evaluatePakuAdapter } from '../evaluator/paku-adapter.mjs';
import { verifyJujumpBrowser } from '../evaluator/jujump-browser.mjs';

try{
  const adapter=await loadJujumpAdapter(),conformance=await evaluatePakuAdapter(adapter.source);
  if(!conformance.passed)throw Error('JUJUMP adapter conformance failed');
  const browser=await verifyJujumpBrowser(adapter,{onProgress:console.log});
  const report={schemaVersion:1,passed:browser.passed,componentId:adapter.componentId,sourceSha256:adapter.sourceSha256,
    javascriptSha256:adapter.javascriptSha256,environment:await jujumpEnvironment(),conformance,browser,metaCalled:false};
  const output=new URL('../reports/jujump-verification.json',import.meta.url);await mkdir(new URL('./',output),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  if(!report.passed)throw Error('JUJUMP browser checks failed; see reports/jujump-verification.json');
  if(process.argv.includes('--save')){
    const target=new URL('../transfers/jujump/verification.json',import.meta.url),tmp=new URL('../transfers/jujump/verification.json.tmp',import.meta.url);
    await writeFile(tmp,JSON.stringify(report,null,2)+'\n');await rename(tmp,target);
  }
  console.log(`JUJUMP verified: ${conformance.results.length} conformance cases, ${browser.results.length} browser checks. No API calls.`);
}catch(error){console.error(error.message);process.exitCode=1;}
