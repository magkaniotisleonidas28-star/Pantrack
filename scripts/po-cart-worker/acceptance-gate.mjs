import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {readPrivate,writePrivate,profileLock} from './private-files.mjs';

export const gatePolicy='metadata-repair-real-matrix-v1';
// Consumed invocations are retained; no invocation may reuse one.
export const consumedGateRoots=Object.freeze(['.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261014','.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261021',
 '.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261022']);
export const fullGateRoot='.sites-runtime/po-cart-workers/full-offline-acceptance-task-20261024';
export const gateSteps=[
 ['metadata',['cart:browser-worker:check:ai:metadata']],
 ['reliability',['cart:browser-worker:check:reliability','--acceptance']],
 ['served-off',['cart:browser-worker:check:ai:http','--diagnostic-mode','off']],
 ['served-passive',['cart:browser-worker:check:ai:http','--diagnostic-mode','passive']],
 ['ai-safety',['cart:browser-worker:check:ai']],
 ...['off','passive','form'].map(mode=>['faults-'+mode,['cart:browser-worker:check:failures','--diagnostic-mode',mode]]),
 ...['typecheck','test','db:check','build','db:migrate:local','test:local'].map(name=>[name,[name]]),
 ...['cart:browser-worker:check','cart:browser-worker:check:http','cart:check','cart:manager:check','cart:browser-session:check','cart:reconciliation:check','cart:manager:check:launcher'].map(name=>[name,[name]])
];
export function sourceSnapshot(root=process.cwd()){
 // Git is already required by the frozen-source gate and CI. NUL delimiters
 // preserve spaces/unicode without requiring a separately installed rg binary.
 const listed=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'});
 const files=[...new Set(listed.split('\0').filter(file=>file&&!/^(?:\.sites-runtime|node_modules|docs|dist|\.wrangler|\.next)(?:\/|$)|(?:\.md|\.tsbuildinfo)$/.test(file)))].sort();
 if(!files.length)throw Error('No source files found for frozen-source gate.');
 const hash=createHash('sha256');for(const file of files)hash.update(file).update('\0').update(readFileSync(resolve(root,file)));
 return {files:files.length,sha256:hash.digest('hex')};
}
export const fileHash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const cleanupCategories=['ownership_unverified','signal_failed','exit_timeout','group_remaining','port_occupied','observation_failed','spawn_error','unconfirmed'];
// A failed step's log keeps only fixed-shape facts: never message text, which can carry
// private values. Locations must name existing repository files.
export function failureSummary(exitCode,output){
 if(exitCode===0)return '';
 const unique=(pattern,pick=m=>m[0],limit=8)=>[...new Set([...output.matchAll(pattern)].map(pick))].slice(0,limit);
 const fields={exit:exitCode??'signal',
  kinds:unique(/\b(?:Assertion|Type|Range|Reference|Syntax|Timeout|Aggregate)?Error(?=[\s:\[]|$)/gm),
  codes:unique(/\b(?:net::)?ERR_[A-Z0-9_]{2,60}\b/g),
  timeoutsMs:unique(/\bTimeout (\d{1,7})ms exceeded/g,m=>m[1]),
  at:unique(/(?:^|[\s(\/])((?:scripts|tests)\/[A-Za-z0-9_.\/-]{1,160}\.(?:mjs|js|ts|py)):(\d{1,6})\b/gm,m=>m[1]+':'+m[2],16).filter(v=>existsSync(v.split(':')[0])).slice(0,8),
  cleanup:unique(/\bLocal application cleanup was not verified \(([^)\n]{1,200})\)/g,m=>m[1]).flatMap(v=>v.split(', ')).filter(v=>cleanupCategories.includes(v))};
 return 'FAILURE summary: '+Object.entries(fields).map(([k,v])=>k+'='+(Array.isArray(v)?v.join(','):v)).join(' ')+'\n';
}
export function requireGateSource(expected,snapshot=sourceSnapshot){
 const current=snapshot();
 if(!expected||current.files!==expected.files||current.sha256!==expected.sha256)throw Error('Frozen gate source changed.');
 return current;
}
export function validatePreparation(pipeline,snapshot=sourceSnapshot){
 const source=requireGateSource(pipeline?.source,snapshot),steps=['typecheck','test','db:check','build','db:migrate:local','test:local'];
 if(pipeline.passed!==true||pipeline.results?.length!==6||pipeline.results.some((r,i)=>r.id!==steps[i]||r.passed!==true||r.exitCode!==0||r.sourceBefore!==source.sha256||r.sourceAfter!==source.sha256||!r.log||fileHash(r.log.path)!==r.log.sha256))throw Error('Successful frozen preparation pipeline required.');
 return source;
}
export function rejectGateArguments(args){if(args.length)throw Error('Single-use full gate accepts no arguments, filters, resume or root override.');}
export function gateAuditsPassed(audits){return audits?.passed===true&&['credentialsRevoked','cleanupVerified','preservationVerified','evidenceVerified','consumptionVerified'].every(k=>audits[k]===true)&&audits.references?.length>=7;}
export function createGateInvocation(root,source){
 if(consumedGateRoots.some(old=>resolve(old)===resolve(root)))throw Error('Consumed gate root is retained and cannot be reused.');
 mkdirSync(root,{recursive:true,mode:0o700});const release=profileLock(root+'/runner');
 try{
  const path=root+'/task.json',fd=openSync(path,'wx',0o600),state={version:2,source,startedAt:new Date().toISOString(),steps:[]};
  try{writeFileSync(fd,JSON.stringify(state)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  if(process.platform!=='win32'){const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
  return {state,release,consume(id,args){
   const next=gateSteps[state.steps.length];if(!next||id!==next[0]||JSON.stringify(args)!==JSON.stringify(next[1]))throw Error('Gate order changed.');
   state.steps.push({index:state.steps.length,id,args,at:new Date().toISOString()});writePrivate(path,state);
  }};
 }catch(e){release();throw e;}
}
export function inspectGateStep(id,output,source,references){
 const match=output.match(/Private (?:reliability evidence|evaluation report|metadata evidence): (.+\/report\.json)/);
 if(['metadata','reliability','served-off','served-passive'].includes(id)){
  if(!match)throw Error('Missing gate evidence.');const path=match[1].trim(),r=readPrivate(path);references.push({path,sha256:fileHash(path)});
  if(r.source?.sha256!==source.sha256)throw Error('Gate evidence source mismatch.');
  if(id==='metadata'){
   if(!r.passed||r.realProviderRequests!==0||r.results.length!==16||r.results.some(v=>!v.passed||!v.credentialsRevoked||!v.cleanup||!v.cleanupVerified||!v.networkCoverageComplete||v.externalRequests!==0||v.checkoutSubmissions!==0)||r.results.filter(v=>v.additions===3&&v.requests===10).length!==4||r.results.filter(v=>v.additions===0&&v.requests===4&&v.restartNoEffects).length!==12||r.results.reduce((n,v)=>n+v.completedRequests,0)!==88)throw Error('Complete sixteen-case Metadata evidence required.');
  }else if(id==='reliability'){
   if(!r.acceptance||r.results.length!==30||r.results.some(v=>!v.passed||v.state!=='ready'||v.additions!==3||v.requests!==10||v.completedRequests!==10||!v.attemptsVerified||!v.credentialsRevoked||!v.cleanupVerified||!v.networkCoverageComplete||v.network?.externalRequests!==0||v.network?.checkoutSubmissions!==0))throw Error('Thirty complete consecutive reliability jobs required.');
   for(const layout of ['rows','compact'])for(const delay of [0,750,1500])if(r.results.filter(v=>v.layout===layout&&v.delay===delay).length!==5)throw Error('Unbalanced reliability gate.');
  }else{
   if(!r.matrixPassed||r.acceptanceComplete||!r.metadataEvidenceRequired||r.results.length!==12||r.requests.length!==72||r.requests.some(v=>v.status!=='completed')||r.results.some(v=>!v.passed||!v.credentialsRevoked||!v.cleanupVerified||!v.networkCoverageComplete||!v.diagnosticsComplete||!v.metadataComplete||v.metadataFiles?.length!==5)||r.diagnosticMode!==(id==='served-off'?'off':'passive'))throw Error('Complete served mocked matrix required.');
   for(const c of r.results){if(c.diagnosticFile)references.push({path:c.diagnosticFile,sha256:fileHash(c.diagnosticFile)});for(const p of c.metadataFiles)references.push({path:p,sha256:fileHash(p)});}
  }
 }
 if(id==='ai-safety'){
  const cases=[...output.matchAll(/PASS offline Stagehand (\d+):/g)].map(m=>Number(m[1]));
  if(cases.length!==50||cases.some((n,i)=>n!==i))throw Error('Uninterrupted fifty-case safety evidence required.');
 }
 if(id.startsWith('faults-')&&(output.match(/PASS injected /g)??[]).length!==4)throw Error('Four expected faults required.');
 const counts={'cart:browser-worker:check':16,'cart:browser-worker:check:http':7,'cart:check':16,'cart:manager:check':8,'cart:browser-session:check':10,'cart:reconciliation:check':6};
 const patterns={'cart:browser-worker:check':/PASS browser HTTP /g,'cart:browser-worker:check:http':/PASS served D1 browser /g,'cart:check':/PASS /g,'cart:manager:check':/PASS manager UI /g,'cart:browser-session:check':/PASS supervised /g,'cart:reconciliation:check':/PASS served reconciliation /g};
 if(counts[id]&&(output.match(patterns[id])??[]).length<counts[id])throw Error('Incomplete regression scenarios.');
}

// Execution is injected for non-browser stop/cleanup regressions. The CLI fixes
// root and every step; a failed invocation is never resumed or repaired.
export async function runFullGate({root=fullGateRoot,source,snapshot=sourceSnapshot,runStep,finalize,control={stopping:false}}){
 requireGateSource(source,snapshot);const task=createGateInvocation(root,source);
 const report={version:2,policy:gatePolicy,source,startedAt:task.state.startedAt,status:'running',passed:false,results:[]};
 const save=()=>writePrivate(root+'/report.json',report);
 const assertSource=()=>{try{return requireGateSource(source,snapshot);}catch(e){control.stopping=true;control.sourceChanged=true;throw e;}};
 try{
  save();for(const [id,args] of gateSteps){
   assertSource();if(control.stopping)throw Error('Interrupted.');task.consume(id,args);
   const entry={id,args,sourceBefore:source.sha256,passed:false,references:[]};report.results.push(entry);save();
   Object.assign(entry,await runStep(id,args,report.results.length-1,assertSource));
   entry.sourceAfter=assertSource().sha256;if(control.stopping||entry.exitCode!==0)throw Error('Step failed.');
   inspectGateStep(id,entry.output,source,entry.references);delete entry.output;entry.passed=true;save();
  }
  report.status='checks_complete';
 }catch{report.status=control.sourceChanged?'source_changed':control.stopping?'interrupted':'stopped';}
 finally{
  for(const r of report.results)delete r.output;
  try{report.audits=await finalize(report);if(report.audits.passed!==true)report.status='audit_failed';}catch{report.status='cleanup_failed';}
  try{assertSource();}catch{report.status='source_changed';}
  if(control.stopping&&report.status==='checks_complete')report.status='interrupted';
  report.passed=report.status==='checks_complete'&&report.results.length===21&&gateAuditsPassed(report.audits);
  if(report.passed)report.status='fresh complete offline gate passed; original cause unresolved';
  report.finishedAt=new Date().toISOString();save();task.release();
 }
 return report;
}
export function validateGate(path){
 const report=readPrivate(path),source=sourceSnapshot();
 if(report.version!==2||!gateAuditsPassed(report.audits)||report.policy!==gatePolicy||report.passed!==true||report.source.sha256!==source.sha256||report.results.length!==gateSteps.length)throw Error('Fresh complete frozen-source gate required.');
 for(const ref of report.audits.references??[])if(fileHash(ref.path)!==ref.sha256)throw Error('Gate audit evidence changed.');
 for(const [index,[id,args]] of gateSteps.entries()){
  const r=report.results[index];
  if(r.id!==id||JSON.stringify(r.args)!==JSON.stringify(args)||r.exitCode!==0||!r.passed||r.sourceBefore!==source.sha256||r.sourceAfter!==source.sha256||!r.references.length)throw Error('Gate result invalid.');
  for(const ref of r.references)if(fileHash(ref.path)!==ref.sha256)throw Error('Gate evidence changed.');
 }
 return {report,source,sha256:fileHash(path)};
}
