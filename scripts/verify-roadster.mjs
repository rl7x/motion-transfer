import {mkdir,writeFile} from 'node:fs/promises';
import {loadSavedRoadster} from '../src/roadster/saved.mjs';
import {evaluateRoadsterAdapter} from '../src/evaluator/roadster.mjs';
import {verifyRoadsterBrowser} from '../src/evaluator/roadster-browser.mjs';

try{
  const artifact=await loadSavedRoadster(),source=artifact.files['adapter.ts'];
  const conformance=await evaluateRoadsterAdapter(source,artifact.intent);
  if(!conformance.passed)throw Error('Saved Roadster mapping failed conformance');
  const browser=await verifyRoadsterBrowser(source,artifact.intent,{onProgress:console.log});
  const report={passed:conformance.passed&&browser.passed,metaCalled:false,artifactId:artifact.id,componentId:artifact.componentId,conformance,browser};
  await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
  await writeFile(new URL('../reports/roadster-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  if(!report.passed)throw Error('Saved Roadster browser checks failed; see reports/roadster-verification.json');
  console.log(`Roadster verified: ${conformance.results.length} mapping cases, ${browser.results.length} browser checks. No Meta API requests made.`);
}catch(error){console.error(error.message);process.exitCode=1;}
