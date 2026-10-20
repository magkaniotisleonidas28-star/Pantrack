import {originalFetch} from './po-cart-worker/offline-boundary.mjs';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {sourceSnapshot,fileHash} from './po-cart-worker/acceptance-gate.mjs';
import {writePrivate,readPrivate} from './po-cart-worker/private-files.mjs';
import {investigationRoot,runInvestigation,validateInvestigationPipeline} from './po-cart-worker/second-addition-investigation.mjs';
import {caseExecutor} from './po-cart-worker/second-addition-case.mjs';
import {evaluationPreflight} from './po-cart-worker/evaluation-preflight.mjs';
import {capturePreview,observePreviewExit,cleanupPreview,verifyPreviewPorts,recordPreviewCleanup} from './po-cart-worker/second-addition-cleanup.mjs';
import {requireHistoricalProfilesIdle} from './po-cart-worker/profile-preservation-preflight.mjs';

if(process.argv.length!==2)throw Error('This single-use investigation accepts no options or resumed slots.');
requireHistoricalProfilesIdle();
const pipeline=readPrivate(investigationRoot+'/pipeline-final.json');
const expectedSource=validateInvestigationPipeline(pipeline,sourceSnapshot);
for(const entry of pipeline.results)if(fileHash(entry.log.path)!==entry.log.sha256)throw Error('Pipeline evidence changed.');
const control={stopping:false};let preview,poll,previewDone,previewIdentity,report;
const stop=()=>{control.stopping=true;control.worker?.requestStop();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
let initialized=false;
try{
 report=await runInvestigation({expectedSource,sourceSnapshot,control,runCase:async(spec,index,assertSource)=>{
  // Task creation/first-slot consumption precede even preview setup.
  if(!initialized){
   assertSource();
   poll=setInterval(()=>{try{assertSource();}catch{stop();}},1000);
   if(!(await verifyPreviewPorts()).portsFree)throw Error('Existing preview preserved.');
   assertSource();
   await build({stdin:{contents:"export * from './scripts/po-cart-worker/browser-adapter';export * from './scripts/po-cart-worker/ai-reader';export * from './scripts/po-cart-worker/browser-diagnostics';export * from './scripts/cart-preview/ai-provider';export * from './scripts/cart-preview/fixture';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:investigationRoot+'/api.mjs',logLevel:'silent'});
   assertSource();
   const api=await import('../'+investigationRoot+'/api.mjs');
   assertSource();
   // Discard preview output: evidence never captures page bodies or credentials.
   preview=spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs'],{detached:true,stdio:'ignore'});
   previewDone=observePreviewExit(preview);
   previewIdentity=capturePreview(preview);
   let ready=false;
   for(let i=0;i<120&&!control.stopping;i++){
    if(preview.exitCode!==null)break;
    try{await evaluationPreflight({snapshot:async()=>({reservedMicros:0})});ready=true;break;}catch{}
    await new Promise(ok=>setTimeout(ok,500));
   }
   if(!ready)throw Error('Local readiness failed.');
   assertSource();
   control.execute=caseExecutor(api,control,{assertSource,onProgress:(s,i,passed)=>console.log(`${passed?'PASS':'STOP'} ${i+1}/12 ${s.diagnosticMode}/${s.reader}/${s.layout}`)});initialized=true;
  }
  return control.execute(spec,index);
 }});
}finally{
 clearInterval(poll);stop();
 let cleanup={verified:true,childExited:true,groupEmpty:true,termSent:false,killSent:false,failures:[]};
 if(preview){
  cleanup=await cleanupPreview(preview,previewDone,previewIdentity);
 }
 const ports=await verifyPreviewPorts();
 // If creation was refused, leave the existing report entirely untouched.
 if(report){
  report=recordPreviewCleanup(report,cleanup,ports);
  writePrivate(investigationRoot+'/report.json',{...report,finishedAt:new Date().toISOString()});
 }
 process.off('SIGINT',stop);process.off('SIGTERM',stop);globalThis.fetch=originalFetch;
}
console.log('Private investigation report: '+investigationRoot+'/report.json');
if(report.status!=='not reproduced; cause unresolved'||!report.processesStopped)process.exitCode=1;
