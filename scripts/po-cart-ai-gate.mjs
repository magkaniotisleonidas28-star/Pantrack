import {spawn,spawnSync} from 'node:child_process';
import {readdirSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {writePrivate,readPrivate} from './po-cart-worker/private-files.mjs';
import {fullGateRoot as root,sourceSnapshot,fileHash,failureSummary,validateGate,validatePreparation,rejectGateArguments,runFullGate} from './po-cart-worker/acceptance-gate.mjs';
import {evaluationPreflight} from './po-cart-worker/evaluation-preflight.mjs';
import {capturePreview,observePreviewExit,cleanupPreview,verifyPreviewPorts,processControls} from './po-cart-worker/second-addition-cleanup.mjs';
import {issuedGateCredentials} from './po-cart-worker/full-gate-runtime.mjs';
import {auditCredentials as auditCapturedCredentials} from './po-cart-worker/credential-audit.mjs';
import {requireHistoricalProfilesIdle} from './po-cart-worker/profile-preservation-preflight.mjs';
rejectGateArguments(process.argv.slice(2));
requireHistoricalProfilesIdle();
const pipeline=readPrivate(root+'/pipeline-final.json'),source=validatePreparation(pipeline);
if(JSON.stringify(readPrivate(root+'/freeze.json'))!==JSON.stringify(source))throw Error('Preparation freeze mismatch.');
// The published observation baseline must still hold before the invocation is consumed.
if(spawnSync('python3',['-I','-B','scripts/po-cart-worker/full-gate-audit.py','before'],{stdio:'ignore'}).status!==0)throw Error('Fresh baseline no longer holds.');
const control={stopping:false};let preview,active,poll,assertSource;
const children=[],previewCleanups=[];
function evidenceRoots(){
 const base='.sites-runtime/po-cart-workers',roots=readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&!['browser-profiles','modules','ai-evaluation',root.split('/').at(-1)].includes(e.name)).map(e=>base+'/'+e.name);
 if(existsSync(base+'/ai-evaluation'))roots.push(...readdirSync(base+'/ai-evaluation',{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>base+'/ai-evaluation/'+e.name));
 return roots;
}
function evidenceFiles(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 const path=dir+'/'+e.name;if(e.isDirectory())return e.name==='profiles'?[]:evidenceFiles(path);
 if(!e.isFile()||!(/(?:report|cleanup|journal|budget|ledger|diagnostics|state).*\.(?:json|jsonl|sqlite)$|\/metadata\/\d+\.json$|\.png$/.test(path)))return [];
 if(path.endsWith('.png'))chmodSync(path,0o600);return [{path,sha256:fileHash(path)}];
});}
const stop=()=>{control.stopping=true;};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
function acquired(child){const done=observePreviewExit(child);const resource={child,done};children.push(resource);resource.identity=capturePreview(child);return resource;}
async function stopChild(resource){if(!resource)return {verified:true,childExited:true,groupEmpty:true,failures:[]};return cleanupPreview(resource.child,resource.done,resource.identity);}
async function startPreview(){
 assertSource();if(!(await verifyPreviewPorts()).portsFree)throw Error('Existing preview preserved.');
 preview=acquired(spawn(process.execPath,['scripts/po-cart-browser-worker-preview.mjs'],{detached:true,stdio:'ignore'}));
 for(let i=0;i<120&&!control.stopping;i++){
  assertSource();if(preview.child.exitCode!==null)break;
  try{await evaluationPreflight({snapshot:async()=>({reservedMicros:0})});return;}catch{}
  await new Promise(ok=>setTimeout(ok,500));
 }
 throw Error('Preview readiness failed.');
}
async function stopPreview(){if(preview){const cleanup=await stopChild(preview);previewCleanups.push(cleanup);preview=undefined;if(!cleanup.verified)throw Error('Preview cleanup failed.');}if(!(await verifyPreviewPorts()).portsFree)throw Error('Ports not free.');}
const safeLog=output=>output.split('\n').filter(line=>/^(?:PASS (?:gate |metadata |offline Stagehand \d+:|injected |served |manager UI |supervised |browser HTTP |rows\/|compact\/)|Private (?:metadata evidence|reliability evidence|evaluation report): )/.test(line)).join('\n')+'\n';
async function auditCredentials(){
 const value=await auditCapturedCredentials({credentials:issuedGateCredentials(),execute:sql=>{
   const file=root+'/revoke.sql';writeFileSync(file,sql,{mode:0o600});
   return spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',file],{stdio:'ignore'}).status===0;
 }});
 writePrivate(root+'/credential-http-audit.json',value);return value;
}
let report;
try{
 report=await runFullGate({source,control,runStep:async(id,args,index,check)=>{
  assertSource=check;
  if(!poll)poll=setInterval(()=>{try{check();}catch{stop();}},1000);
  if(!preview&&index===0)await startPreview();
  if(id==='cart:manager:check:launcher')await stopPreview();check();
  console.log(`START gate ${index+1}/21 ${id}`);
  const before=new Set(evidenceRoots());
  let output='';active=acquired(spawn('pnpm',args,{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PANTRACK_FULL_OFFLINE_GATE:'enabled',OPENAI_API_KEY:'fictional-test-only'}}));
  active.child.stdout.on('data',b=>{output+=b;});active.child.stderr.on('data',b=>{output+=b;});
  let stoppingChild;const interrupt=setInterval(()=>{if(control.stopping&&!stoppingChild)stoppingChild=stopChild(active);},1000);
  await active.done;clearInterval(interrupt);if(stoppingChild)await stoppingChild;
  const exitCode=active.child.exitCode,cleanup=await stopChild(active);active=undefined;
  const path=root+'/'+index+'-'+id.replaceAll(':','-')+'.log';writeFileSync(path,safeLog(output)+failureSummary(exitCode,output),{flag:'wx',mode:0o600});
  const cleanupPath=root+'/'+index+'-process.json';writePrivate(cleanupPath,cleanup);
  const evidence=evidenceRoots().filter(path=>!before.has(path)).flatMap(evidenceFiles);
  writePrivate(root+'/'+index+'-evidence.json',evidence);
  if(!cleanup.verified)throw Error('Child process cleanup unverified.');
  check();console.log(`${exitCode===0?'CHECKED':'STOP'} gate ${index+1}/21 ${id}`);
  return {exitCode,output,references:[{path,sha256:fileHash(path)},{path:cleanupPath,sha256:fileHash(cleanupPath)},...evidence]};
 },finalize:async value=>{
  clearInterval(poll);let activeCleanup=await stopChild(active);active=undefined;
  // HTTP revocation is audited while the owned fixture application is available.
  // Starting only the local fixture server here makes no browser/provider probe.
  if(!preview&&!control.stopping){await startPreview();}
  const credentials=await auditCredentials();let previewVerified=true;
  try{await stopPreview();}catch{previewVerified=false;}
  const ports=await verifyPreviewPorts(),processes=processControls.snapshot();
  const profiles=existsSync(root+'/profiles')?readdirSync(root+'/profiles').map(file=>readPrivate(root+'/profiles/'+file)):[];
  const profilesClear=profiles.every(p=>!processes.some(row=>row.command.split(/\s+/).includes('--user-data-dir='+p.path)));
  const nested=existsSync(root+'/children')?readdirSync(root+'/children').map(file=>readPrivate(root+'/children/'+file)):[];
  const groupsClear=children.every(r=>!processes.some(p=>p.group===r.child.pid))&&nested.every(r=>!processes.some(p=>p.group===r.group));
  writePrivate(root+'/process-audit.json',{passed:activeCleanup.verified&&previewVerified&&ports.portsFree&&profilesClear&&groupsClear,activeCleanup,previewCleanups,ports,profilesClear,groupsClear,profiles:profiles.length});
  const preservation=spawnSync('python3',['scripts/po-cart-worker/full-gate-audit.py'],{stdio:'ignore'}).status===0;
  const references=['credential-http-audit.json','process-audit.json','preservation.json','database-delta.json','task.json','pipeline-final.json','freeze.json'].filter(file=>existsSync(root+'/'+file)).map(file=>({path:root+'/'+file,sha256:fileHash(root+'/'+file)}));
  const consumed=readPrivate(root+'/task.json').steps;
  const consumptionVerified=consumed.length===value.results.length&&consumed.every((s,i)=>s.index===i&&s.id===value.results[i].id);
  const evidenceVerified=value.results.every(r=>r.references.every(ref=>fileHash(ref.path)===ref.sha256));
  const audits={credentialsRevoked:credentials.passed,cleanupVerified:activeCleanup.verified&&previewVerified&&ports.portsFree&&profilesClear&&groupsClear,preservationVerified:preservation,evidenceVerified,consumptionVerified,references};
  audits.passed=Object.entries(audits).filter(([k])=>k!=='references').every(([,v])=>v===true);
  writePrivate(root+'/final-audit.json',audits);return audits;
 }});
 if(report.passed)validateGate(root+'/report.json');
 console.log((report.passed?'PASS':'STOP')+' offline gate; original cause unresolved. Private gate report: '+root+'/report.json');
 if(!report.passed)process.exitCode=1;
}finally{clearInterval(poll);process.off('SIGINT',stop);process.off('SIGTERM',stop);}
