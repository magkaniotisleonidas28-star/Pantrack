import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {writePrivate,profileLock} from './private-files.mjs';
import {fixtureCredential} from './credentials.mjs';
import {LocalBrowserCartWorker} from './browser-adapter';
import {StagehandCartReader,type CartReader} from './ai-reader';
import {AiBudgetLedger} from '../cart-preview/ai-budget.mjs';
import {modelConfig} from '../cart-preview/ai-config.mjs';
import {catalog} from '../cart-preview/fixture';
import {evaluationPreflight,validatePaidAllowance,consumePaidAllowance,EvaluationPreflightError} from './evaluation-preflight.mjs';
import {browserDiagnostics} from './browser-diagnostics';
import {verifyEvaluationDiagnostics} from './evaluation-diagnostics';
import {sourceSnapshot} from './acceptance-gate.mjs';
import {metadataEvidence,verifyMetadataEvidence,type MetadataEvidenceSink} from './metadata-evidence';
import {assertGateSource} from './full-gate-runtime.mjs';
import {verifyAdditionAttempts} from './second-addition-case.mjs';
const sdkVersion=(name:string)=>{let path=fileURLToPath(import.meta.resolve(name));for(let i=0;i<5;i++){
  path=dirname(path);try{const p=JSON.parse(readFileSync(path+'/package.json','utf8'));if(p.name===name)return p.version;}catch{}
}return 'unverified';};
type Seeder=typeof import('./local-browser-fixture.mjs')['seedLocalBrowserJob'];
// Test-only dependency injection always labels reports offline. The CLI exposes
// no overrides and therefore cannot count mocked calls as real-AI evidence.
export async function runEvaluation(seedLocalBrowserJob:Seeder,offline?:{offline:true;ledger:AiBudgetLedger;reader:(f:Awaited<ReturnType<Seeder>>,evidence:MetadataEvidenceSink)=>CartReader;readinessTransport?:typeof fetch;diagnosticMode?:'off'|'passive';diagnostics?:typeof browserDiagnostics;metadataEvidence?:typeof metadataEvidence;allowanceCheck?:()=>void;allowanceConsume?:(runId:string)=>void}){
const config=modelConfig(),ledger=offline?.ledger??new AiBudgetLedger(),runId=randomUUID(),root='.sites-runtime/po-cart-workers/ai-evaluation/'+runId;
if(sdkVersion('@browserbasehq/stagehand')!=='4.1.0'||sdkVersion('playwright-core')!=='1.61.1')throw Error('Evaluation SDK versions differ from the reviewed configuration.');
const release=profileLock('.sites-runtime/po-cart-workers/ai-evaluation/run');
const results:any[]=[],caseIds:string[]=[];let stopping=false,worker:LocalBrowserCartWorker|undefined;
const stop=()=>{stopping=true;worker?.requestStop();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const startedAt=new Date().toISOString();
const source=sourceSnapshot(),diagnosticMode=offline?.diagnosticMode??(offline?'off':'passive'),streams=new Map<string,ReturnType<typeof browserDiagnostics>>();
const metadataStreams=new Map<string,MetadataEvidenceSink>();
let preflight:any={passed:false,reason:'not_run'};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function report(){
 const budget=await ledger.snapshot(),requests=budget.reservations.filter((r:any)=>caseIds.includes(r.caseId));
 const complete=results.length===12&&results.every(r=>r.passed)&&requests.length===72&&requests.every((r:any)=>r.status==='completed')
  &&metadataStreams.size===12&&[...metadataStreams.values()].every(s=>s.healthy())&&!stopping&&sourceSnapshot().sha256===source.sha256;
 const manualSeconds=Number(process.env.PANTRACK_CART_MANUAL_SECONDS)||null;
 const value={evidence:offline?'offline-mocked-model-served-durable-worker':complete?'local-real-ai-fictional-durable-worker':'incomplete-local-ai-evaluation',runId,startedAt,finishedAt:new Date().toISOString(),matrixPassed:complete,acceptanceComplete:complete&&!offline,
  model:config.model,reasoning:'none',stagehand:sdkVersion('@browserbasehq/stagehand'),playwright:sdkVersion('playwright-core'),node:process.version,
  inputUsdPerMillion:config.inputRate,outputUsdPerMillion:config.outputRate,source,diagnosticMode,metadataEvidenceRequired:true,preflight,results,requests,
  conservativeCumulativeUsd:budget.reservedMicros/1e6,actualBillingUsd:null,billingStatus:'pending owner billing comparison',manualSeconds,
  manualTimingComparison:manualSeconds?'Recorded manual duration supplied; compare with successful case timings.':'pending',supplierCompatibility:'unverified'};
 writePrivate(root+'/report.json',value);return value;
}
try{
 try{
  preflight=await evaluationPreflight(ledger,offline?.readinessTransport);
  if(!offline)validatePaidAllowance();else offline.allowanceCheck?.();
  try{
   if(diagnosticMode==='passive')for(const layout of ['rows','compact'])for(const scenario of ['normal','malicious','price_changed','unavailable','wrong_pack','ambiguous']){
    const key=layout+'-'+scenario;streams.set(key,(offline?.diagnostics??browserDiagnostics)(root+'/'+key+'/diagnostics.jsonl'));
   }
  }catch{throw new EvaluationPreflightError('diagnostic_setup_unavailable');}
  try{
   for(const layout of ['rows','compact'])for(const scenario of ['normal','malicious','price_changed','unavailable','wrong_pack','ambiguous']){
    const key=layout+'-'+scenario;metadataStreams.set(key,(offline?.metadataEvidence??metadataEvidence)(root+'/'+key+'/metadata'));
   }
  }catch{throw new EvaluationPreflightError('metadata_setup_unavailable');}
  if(!offline)consumePaidAllowance(runId);else offline.allowanceConsume?.(runId);
 }catch(e){
  preflight={passed:false,reason:e instanceof EvaluationPreflightError?e.code:'preflight_unavailable'};
  const value=await report();console.log('Evaluation preflight blocked before fixtures or model requests. Private report: '+root+'/report.json');process.exitCode=1;return value;
 }
 for(const layout of ['rows','compact'] as const)for(const scenario of ['normal','malicious','price_changed','unavailable','wrong_pack','ambiguous'] as const){
  if(stopping)break;
  const start=performance.now();let f:Awaited<ReturnType<typeof seedLocalBrowserJob>>|undefined;
  const result:any={layout,scenario,passed:false,elapsedMs:null,interventions:0,modelCalls:0,reason:'incomplete'};
  try{
   if(sourceSnapshot().sha256!==source.sha256)throw Error('Frozen source changed.');
   f=await seedLocalBrowserJob({layout,scenario,root:root+'/'+layout+'-'+scenario});caseIds.push(f.jobId!);
   const baseline=structuredClone(f.readSession().entries);
   const diagnosticFile=f.root+'/diagnostics.jsonl',stream=streams.get(layout+'-'+scenario);
   const metadata=metadataStreams.get(layout+'-'+scenario)!;result.metadataFiles=metadata.files();
   worker=new LocalBrowserCartWorker({credentialFile:f.credentialFiles[0],journalFile:f.root+'/journal.json',fixtureFile:f.fixtureFile,origin:f.origin,reader:offline?offline.reader(f,metadata):new StagehandCartReader(undefined,metadata),headless:!process.argv.includes('--visible'),diagnosticMode,diagnosticFile,diagnosticStream:stream});
   assertGateSource();try{await worker.tick();}catch{result.interventions++;}
   // tick has stopped the browser. Inspect the fixture independently afterward.
   const stopped=worker;worker.close();worker=undefined;
   const current=await f.request(`/api/po-cart-jobs?companyId=${f.companyId}&jobId=${f.jobId}`),session=f.readSession();
   const ready=scenario==='normal'||scenario==='malicious';
   const expected=[...baseline,...catalog.map((l,i)=>({sku:l.sku,unitLabel:l.unitLabel,packs:String(i+1),unitMinor:l.unitMinor}))];
   const ordered=(entries:any[])=>entries.map(e=>[e.sku,e.unitLabel,e.packs,e.unitMinor]).sort((a,b)=>a[0].localeCompare(b[0]));
   const exact=equal(ordered(session.entries),ordered(ready?expected:baseline));
   const budget=await ledger.snapshot(),calls=budget.reservations.filter((r:any)=>r.caseId===f!.jobId);
   const required=ready?['baseline','product:DEMO-COFFEE','product:DEMO-OAT','product:DEMO-CUPS','final']:['baseline','product:DEMO-COFFEE'];
   const realCalls=required.every(p=>['Extraction','Metadata'].every(name=>calls.filter((c:any)=>c.phase===p+':'+name&&c.status==='completed').length===1));
   const additions=stopped.state.calls.length,network=stopped.state.browserNetwork;
   result.networkCoverageComplete=network?.pageIntercepted===true;
   result.cleanupVerified=!!network&&network.proxyClosed&&network.driverClosed&&network.browserClosed&&network.cleanupErrors===0;
   result.attemptsVerified=ready?verifyAdditionAttempts(current):current.attempts.length===0&&current.results.length===0;
   result.diagnosticFile=diagnosticMode==='passive'?diagnosticFile:null;
   result.diagnosticsComplete=diagnosticMode==='off'||Boolean(stream?.healthy()&&verifyEvaluationDiagnostics(diagnosticFile,required.flatMap(p=>[p+':Extraction',p+':Metadata']),additions));
   metadata.close();
   result.metadataComplete=metadata.healthy()&&verifyMetadataEvidence(metadata.files(),required.map(p=>p+':Metadata'));
   result.state=current.job.state;result.exactFixtureCart=exact;result.modelCalls=calls.length;result.completedModelCalls=calls.filter((c:any)=>c.status==='completed').length;
   result.browserAdditions=additions;result.externalBrowserRequests=network?.externalRequests??null;result.checkoutSubmissions=network?.checkoutSubmissions??null;
   result.blockedChromiumBackgroundRequests=network?.blockedBackgroundRequests??null;
   result.blockedTelemetryRequests=network?.blockedTelemetry??null;
   result.inventoryUnchanged=equal(await f.request('/api/inventory?companyId='+f.companyId),f.inventory);result.reservationUnchanged=equal(current.authorization.reservation,f.reservation);
   result.passed=current.job.state===(ready?'ready':'review_needed')&&exact&&realCalls&&calls.length===(ready?10:4)&&additions===(ready?3:0)
    &&network?.externalRequests===0&&network?.checkoutSubmissions===0&&result.inventoryUnchanged&&result.reservationUnchanged&&result.diagnosticsComplete&&result.metadataComplete&&result.networkCoverageComplete&&result.cleanupVerified&&result.attemptsVerified;
   result.reason=result.passed?'verified':'acceptance check failed or real model calls incomplete';
  }catch{result.reason='local application, model, budget or private evidence unavailable';result.interventions++;}
  finally{
   if(worker){worker.close();worker=undefined;}
   metadataStreams.get(layout+'-'+scenario)?.close();
   result.credentialsRevoked=Boolean(f);
   if(f)for(const file of f.credentialFiles){try{await fixtureCredential({execute:f.execute,file,companyId:f.companyId,action:'revoke'});
    const r=await fetch(f.origin+'/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+JSON.parse(readFileSync(file,'utf8')).secret}});await r.body?.cancel();if(r.status!==401)throw Error();
   }catch{result.credentialsRevoked=false;result.passed=false;result.reason='fixture credential cleanup needs local review';}}
   result.elapsedMs=Math.round(performance.now()-start);results.push(result);await report();
  }
  console.log((result.passed?'PASS':'INCOMPLETE')+(offline?' offline served AI ':' real-AI ')+layout+'/'+scenario);
  if(!result.passed){stopping=true;break;}
 }
 const value=await report();console.log('Private evaluation report: '+root+'/report.json');if(!value.matrixPassed)process.exitCode=1;return value;
}finally{for(const stream of streams.values())stream.close();for(const stream of metadataStreams.values())stream.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);release();}
}
