import {writeFile,mkdir} from 'node:fs/promises';
import {recordTransferComparison} from '../evaluator/transfer-comparison.mjs';
try{
  const report=await recordTransferComparison();
  const output=new URL(process.argv.includes('--save')?'../transfers/comparison.json':'../reports/transfer-comparison.json',import.meta.url);
  await mkdir(new URL('./',output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log('Measured agreement: compiled donor, standalone component, PAKU PAKU and JUJUMP; 100 updates each. No API calls.');
}catch(error){console.error(error.message);process.exitCode=1;}
