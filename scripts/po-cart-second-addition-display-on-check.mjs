import {originalFetch} from './po-cart-worker/offline-boundary.mjs';
import {build} from 'esbuild';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {sourceSnapshot} from './po-cart-worker/acceptance-gate.mjs';
import {writePrivate,readPrivate} from './po-cart-worker/private-files.mjs';
import {runInvestigation,requireInvestigationSource} from './po-cart-worker/second-addition-investigation.mjs';
import {caseExecutor} from './po-cart-worker/second-addition-case.mjs';
import {evaluationPreflight} from './po-cart-worker/evaluation-preflight.mjs';
import {capturePreview,observePreviewExit,cleanupPreview,verifyPreviewPorts} from './po-cart-worker/second-addition-cleanup.mjs';
import {auditCredentials} from './po-cart-worker/credential-audit.mjs';
import {displayOnPower} from './po-cart-worker/display-on-power.mjs';
import {displayOnRoot as root,displayOnCases,displayOnSuccess,displayOnDelay,displayOnPreparation,rejectDisplayOnArguments,finishDisplayOnRun} from './po-cart-worker/display-on-investigation.mjs';
import {requireHistoricalProfilesIdle} from './po-cart-worker/profile-preservation-preflight.mjs';

rejectDisplayOnArguments(process.argv.slice(2));
requireHistoricalProfilesIdle();
const expectedSource=displayOnPreparation(root,sourceSnapshot);
const control={stopping:false},power=displayOnPower({root,control});
let preview,poll,previewDone,previewIdentity,report,initialized=false,powerStarted=false;
const stop=()=>{control.stopping=true;control.worker?.requestStop();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 report=await runInvestigation({root,expectedSource,sourceSnapshot,control,cases:displayOnCases(),successStatus:displayOnSuccess,runCase:async(spec,index,assertSource)=>{
  // Durable invocation/slot consumption precede power, preview and job setup.
  if(!initialized){
   assertSource();powerStarted=true;await power.start();
   poll=setInterval(()=>{try{assertSource();power.sample();}catch{stop();}},1000);
   if(!(await verifyPreviewPorts()).portsFree)throw Error('Existing preview preserved.');
   assertSource();
   await build({stdin:{contents:"export * from './scripts/po-cart-worker/browser-adapter';export * from './scripts/po-cart-worker/ai-reader';export * from './scripts/po-cart-worker/browser-diagnostics';export * from './scripts/cart-preview/ai-provider';export * from './scripts/cart-preview/fixture';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:root+'/api.mjs',logLevel:'silent'});
   assertSource();const api=await import('../'+root+'/api.mjs');assertSource();
   preview=spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs'],{detached:true,stdio:'ignore'});
   previewDone=observePreviewExit(preview);previewIdentity=capturePreview(preview);
   let ready=false;
   for(let i=0;i<120&&!control.stopping;i++){
    if(preview.exitCode!==null)break;
    try{await evaluationPreflight({snapshot:async()=>({reservedMicros:0})});ready=true;break;}catch{}
    await new Promise(ok=>setTimeout(ok,500));
   }
   if(!ready)throw Error('Local readiness failed.');assertSource();
   control.execute=caseExecutor(api,control,{root,assertSource,delay:displayOnDelay,credentialAudit:true,
    onProgress:(s,i,passed)=>console.log(`${passed?'PASS':'STOP'} ${i+1}/12 ${s.diagnosticMode}/${s.reader}/${s.layout}/1500ms`)});
   initialized=true;
  }
  power.check('before_case_'+index);assertSource();if(control.stopping)throw Error('Interrupted.');
  const value=await control.execute(spec,index);
  try{power.check('after_case_'+index);value.powerVerified=true;}catch{value.passed=false;value.powerVerified=false;}
  return value;
 }});
}finally{
 clearInterval(poll);stop();
 // A report-write failure after setup still requires independent resource cleanup.
 if(!report&&powerStarted){try{report=readPrivate(root+'/report.json');}catch{report={source:expectedSource,status:'evidence_failed',results:[]};}}
 // Always audit captured capabilities independently before stopping HTTP.
 const audit=async()=>{
  const credentials=[];
  for(const name of existsSync(root+'/cases')?readdirSync(root+'/cases'):[]){
   const dir=root+'/cases/'+name+'/issued';
   if(existsSync(dir))for(const file of readdirSync(dir))credentials.push(readPrivate(dir+'/'+file));
  }
  const execute=async sql=>{
   const file=root+'/cleanup.sql';writeFileSync(file,sql,{mode:0o600});
   try{return spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',file],{stdio:'ignore'}).status===0;}
   finally{unlinkSync(file);}
  };
  const value=await auditCredentials({credentials,execute});writePrivate(root+'/credential-http-audit.json',value);return value;
 };
 // Refused invocations leave every retained artifact untouched.
 if(report){
  report=await finishDisplayOnRun(report,{audit,
   closePreview:()=>preview?cleanupPreview(preview,previewDone,previewIdentity):{verified:true,childExited:true,groupEmpty:true,failures:[]},
   ports:verifyPreviewPorts,closePower:()=>powerStarted?power.close():{verified:true}});
  try{requireInvestigationSource(sourceSnapshot,expectedSource);}catch{report.status='source_changed';}
  writePrivate(root+'/report.json',{...report,finishedAt:new Date().toISOString()});
 }
 process.off('SIGINT',stop);process.off('SIGTERM',stop);globalThis.fetch=originalFetch;
}
console.log('Private investigation report: '+root+'/report.json');
if(report.status!==displayOnSuccess||!report.processesStopped||!report.powerCleanup.verified||!report.credentialAudit.passed)process.exitCode=1;
