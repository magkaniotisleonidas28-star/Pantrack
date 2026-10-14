import {spawn} from 'node:child_process';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {writePrivate,readPrivate,profileLock} from './po-cart-worker/private-files.mjs';
import {gatePolicy,gateSteps,sourceSnapshot,fileHash,validateGate} from './po-cart-worker/acceptance-gate.mjs';
import {evaluationPreflight} from './po-cart-worker/evaluation-preflight.mjs';

const root='.sites-runtime/po-cart-workers/instrumented-gate-'+randomUUID(),release=profileLock('.sites-runtime/po-cart-workers/instrumented-gate');
const report={policy:gatePolicy,source:sourceSnapshot(),startedAt:new Date().toISOString(),passed:false,results:[]};
let preview,active,stopping=false;
const save=()=>writePrivate(root+'/report.json',{...report,finishedAt:new Date().toISOString()});
const unchanged=()=>{if(sourceSnapshot().sha256!==report.source.sha256)throw Error('Source changed; all collected gate evidence is invalid.');};
const stop=()=>{stopping=true;for(const p of [active,preview])if(p)try{process.kill(-p.pid,'SIGTERM');}catch{}};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
async function freePorts(){for(const port of [5181,5182])await new Promise((ok,fail)=>{const p=createServer();p.once('error',()=>fail(Error('Existing preview preserved; gate requires free ports.')));p.listen(port,'127.0.0.1',()=>p.close(ok));});}
async function ready(){await evaluationPreflight({snapshot:async()=>({reservedMicros:0})});}
async function startPreview(){
 await freePorts();unchanged();const fd=openSync(root+'/preview-'+Date.now()+'.log','wx',0o600);
 try{preview=spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs'],{detached:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 preview.done=new Promise(ok=>{preview.once('error',()=>ok(-1));preview.once('exit',code=>ok(code));});
 for(let i=0;i<120&&!stopping;i++){
  if(preview.exitCode!==null)throw Error('Task-owned preview failed to start.');
  try{await ready();return;}catch{}
  await new Promise(ok=>setTimeout(ok,500));
 }
 throw Error('Task-owned preview readiness failed.');
}
async function stopPreview(){
 if(!preview)return;const p=preview;try{process.kill(-p.pid,'SIGTERM');}catch{}
 let timer;try{await Promise.race([p.done,new Promise((_,fail)=>{timer=setTimeout(()=>fail(Error('Task-owned preview did not stop.')),15000);})]);}finally{clearTimeout(timer);}
 preview=undefined;await freePorts();
}
function inspect(id,output,references){
 const match=output.match(/Private (?:reliability evidence|evaluation report|metadata evidence): (.+\/report\.json)/);
 if(match){
  const path=match[1].trim(),r=readPrivate(path);references.push({path,sha256:fileHash(path)});
  if(id==='metadata'){
   if(!r.passed||r.realProviderRequests!==0||r.source.sha256!==report.source.sha256||r.results.length!==16
    ||r.results.some(v=>!v.passed||!v.credentialsRevoked||!v.cleanup)||r.results.filter(v=>v.additions===3&&v.requests===10).length!==4
    ||r.results.filter(v=>v.additions===0&&v.requests===4&&v.restartNoEffects).length!==12)throw Error('Complete sixteen-case Metadata matrix required.');
  }else if(id==='reliability'){
   if(!r.acceptance||r.results.length!==30||r.results.some(v=>!v.passed||v.state!=='ready'||v.additions!==3||v.requests!==10))throw Error('Thirty consecutive fresh reliability jobs required.');
   for(const layout of ['rows','compact'])for(const delay of [0,750,1500])if(r.results.filter(v=>v.layout===layout&&v.delay===delay).length!==5)throw Error('Unbalanced reliability gate.');
  }else{
   if(!r.matrixPassed||r.acceptanceComplete||!r.metadataEvidenceRequired||r.results.length!==12||r.requests.length!==72||r.requests.some(v=>v.status!=='completed')||r.results.some(v=>!v.passed||!v.credentialsRevoked||!v.diagnosticsComplete||!v.metadataComplete||v.metadataFiles?.length!==5)||r.diagnosticMode!==(id==='served-off'?'off':'passive')||r.source.sha256!==report.source.sha256)throw Error('Complete served mocked matrix required.');
   for(const c of r.results){
    if(c.diagnosticFile)references.push({path:c.diagnosticFile,sha256:fileHash(c.diagnosticFile)});
    for(const path of c.metadataFiles)references.push({path,sha256:fileHash(path)});
   }
  }
 }else if(['metadata','reliability','served-off','served-passive'].includes(id))throw Error('Missing required gate report.');
 if(id==='ai-safety'){
  const cases=[...output.matchAll(/PASS offline Stagehand (\d+):/g)].map(m=>Number(m[1]));
  if(cases.length!==50||cases.some((n,i)=>n!==i))throw Error('Uninterrupted unfiltered 50-case safety gate required.');
 }
 if(id.startsWith('faults-')&&(output.match(/PASS injected /g)??[]).length!==4)throw Error('Four injected faults required.');
}
try{
 save();writePrivate(root+'/decision.json',{policy:gatePolicy,decision:'Offline preparation for one Metadata repair matrix; separate explicit paid authorization required.',historicalCause:'unresolved',paidRequestsAuthorized:false,allowance:'separate single-use metadata-repair allowance; prior consumed allowance preserved',source:report.source});
 await startPreview();
 for(const [index,[id,args]] of gateSteps.entries()){
  if(stopping)throw Error('Gate interrupted.');unchanged();
  if(id==='cart:manager:check:launcher')await stopPreview();
  const log=root+'/'+index+'-'+id.replaceAll(':','-')+'.log',entry={id,args,sourceBefore:report.source.sha256,startedAt:new Date().toISOString(),exitCode:null,passed:false,references:[]};
  report.results.push(entry);save();console.log('START gate '+(index+1)+'/'+gateSteps.length+' '+id);
  const fd=openSync(log,'wx',0o600);
  try{active=spawn('pnpm',args,{detached:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
  entry.exitCode=await new Promise(ok=>{active.once('error',()=>ok(-1));active.once('exit',code=>ok(code));});active=undefined;
  entry.sourceAfter=sourceSnapshot().sha256;entry.finishedAt=new Date().toISOString();entry.references.push({path:log,sha256:fileHash(log)});
  try{
   unchanged();if(entry.exitCode!==0)throw Error('Command failed.');inspect(id,readFileSync(log,'utf8'),entry.references);entry.passed=true;
  }finally{save();}
  console.log('PASS gate '+(index+1)+'/'+gateSteps.length+' '+id);
 }
 await startPreview();await ready();unchanged();report.passed=true;save();validateGate(root+'/report.json');
 console.log('PASS all frozen-source offline gates. Private gate report: '+root+'/report.json');
}catch{
 report.passed=false;save();console.error('STOP offline gate. No allowance authorization or paid requests. Retained evidence: '+root+'/report.json');process.exitCode=1;
}finally{await stopPreview();process.off('SIGINT',stop);process.off('SIGTERM',stop);release();}
