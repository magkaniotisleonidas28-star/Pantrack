import {existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {seedLocalBrowserJob} from './local-browser-fixture.mjs';
import {fixtureCredential} from './credentials.mjs';
import {readPrivate} from './private-files.mjs';
import {AiBudgetLedger} from '../cart-preview/ai-budget.mjs';
import {mockedReader} from './mock-ai-reader.mjs';
import {investigationRoot,inspectDiagnostics,classifyFailure} from './second-addition-investigation.mjs';
import {cleanupTaskBrowser,finishCase} from './second-addition-cleanup.mjs';
import {auditCredentials} from './credential-audit.mjs';
import {writePrivate} from './private-files.mjs';

export function verifyAdditionAttempts(current){
 const lines=current.job.inputs.preflight.lines;
 return lines.length===3&&current.attempts.length===3&&current.results.length===3&&lines.every(line=>{
  const attempts=current.attempts.filter(a=>a.lineId===line.lineId);
  if(attempts.length!==1)return false;
  const attempt=attempts[0],results=current.results.filter(r=>r.attemptId===attempt.id);
  return results.length===1&&results[0].outcome==='verified'&&['lineId','sku','unitLabel','packs','unitMinor'].every(k=>
   attempt.intent[k]===line[k]&&results[0].observation?.[k]===line[k]);
 });
}

function profilePath(f){
 const key=createHash('sha256').update(JSON.stringify(['http://127.0.0.1:5182',f.companyId,'cart-demo-supplier','DEMO-CART'])).digest('hex');
 return resolve('.sites-runtime/po-cart-workers/browser-profiles',key);
}

export function delayedApplicationReads(transport,delay,pause=ms=>new Promise(ok=>setTimeout(ok,ms))){
 return async(url,options)=>{
  const response=await transport(url,options);
  if(options.method==='GET'&&delay)await pause(delay);return response;
 };
}

export function caseExecutor(api,control,{root=investigationRoot,assertSource,seedJob=seedLocalBrowserJob,onProgress=()=>{},delay=0,fetchImpl=fetch,requestLimit=60,credentialAudit=false}={}){
 let requests=0;
 return async(spec,index)=>{
  const dir=root+'/cases/'+index,diagnosticFile=dir+'/diagnostics.jsonl';
  const result={startedAt:new Date().toISOString(),error:'none',passed:false};
  let f,context,worker,ledger,evidence,diagnostic,phase='setup',tickFailed=false;
  const issuing=[];
  const execute=async sql=>{
   // Also available after partial fixture setup, when the seeder cannot return.
   const file=dir+'/cleanup.sql';writeFileSync(file,sql,{mode:0o600});
   try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',file],{stdio:'ignore'});
    if(r.status!==0)throw Error('Credential cleanup failed.');return true;
   }finally{unlinkSync(file);}
  };
  try{
   assertSource();
   if(control.stopping)throw Error();
   f=await seedJob({layout:spec.layout,scenario:'normal',root:dir,onContext:c=>{context=c;},onIssuing:c=>{
    issuing.push(c);if(credentialAudit)writePrivate(dir+'/issued/'+c.credentialId+'.json',c);
   }});
   if(control.stopping)throw Error();
   const initial=structuredClone(f.readSession().entries);
   ledger=new AiBudgetLedger(dir+'/mock-budget.json',dir+'/absent.json');
   diagnostic=api.browserDiagnostics(spec.diagnosticMode==='off'?undefined:diagnosticFile);
   const stream={...diagnostic,emit:(event,fields)=>{
    diagnostic.emit(event,fields);
    if(!diagnostic.healthy()&&!control.stopping){control.stopping=true;worker?.requestStop();}
   }};
   worker=new api.LocalBrowserCartWorker({credentialFile:f.credentialFiles[0],journalFile:dir+'/journal.json',fixtureFile:f.fixtureFile,origin:f.origin,
    diagnosticMode:spec.diagnosticMode,diagnosticFile,diagnosticStream:stream,retainFailureMessage:false,
    reader:spec.reader==='stagehand'?mockedReader(api,f,ledger,delay,()=>{
     assertSource();if(control.stopping||requests>=requestLimit)throw Error('Mock request bound reached.');requests++;
    }):undefined,
    fetchImpl:spec.reader==='deterministic'&&delay?delayedApplicationReads(fetchImpl,delay):fetchImpl});
   control.worker=worker;phase='worker';
   assertSource();
   if(control.stopping)throw Error();
   try{await worker.tick();}catch{tickFailed=true;result.error='worker_failed';}
   phase='inspection';
   const current=await f.request(`/api/po-cart-jobs?companyId=${f.companyId}&jobId=${f.jobId}`),session=f.readSession();
   const expected=[...initial,...api.catalog.map((l,i)=>({sku:l.sku,unitLabel:l.unitLabel,packs:String(i+1),unitMinor:l.unitMinor}))];
   result.state=current.job.state;result.additions=worker.state.calls.length;result.attempts=current.attempts.length;
   result.verifiedResults=current.results.filter(r=>r.outcome==='verified').length;
   result.stage=worker.state.browserFailure?.stage;
   result.exactCart=JSON.stringify(session.entries)===JSON.stringify(expected);
   result.safeCart=session.entries.length<=expected.length&&JSON.stringify(session.entries)===JSON.stringify(expected.slice(0,session.entries.length));
   result.inventoryUnchanged=JSON.stringify(await f.request('/api/inventory?companyId='+f.companyId))===JSON.stringify(f.inventory);
   result.reservationUnchanged=JSON.stringify(current.authorization.reservation)===JSON.stringify(f.reservation);
   result.attemptsVerified=verifyAdditionAttempts(current);
   result.externalRequests=worker.state.browserNetwork?.externalRequests;
   result.checkoutSubmissions=worker.state.browserNetwork?.checkoutSubmissions;
   result.networkCoverageComplete=worker.state.browserNetwork?.pageIntercepted===true;
   const reservations=spec.reader==='stagehand'?(await ledger.snapshot()).reservations:[];
   result.requests=reservations.length;result.completedRequests=reservations.filter(r=>r.status==='completed').length;
   result.passed=!tickFailed&&result.state==='ready'&&result.additions===3&&result.attemptsVerified&&result.exactCart&&result.safeCart
    &&result.inventoryUnchanged&&result.reservationUnchanged&&result.networkCoverageComplete&&result.externalRequests===0&&result.checkoutSubmissions===0
    &&result.requests===(spec.reader==='stagehand'?10:0)&&result.completedRequests===result.requests;
  }catch{result.error=phase==='setup'?'setup_failed':phase==='worker'?'worker_failed':'inspection_failed';result.passed=false;}
  finally{
   control.worker=undefined;
   const observed=worker?.state.browserNetwork;
   result.stage??=worker?.state.browserFailure?.stage;
   result.externalRequests=observed?.externalRequests;
   result.checkoutSubmissions=observed?.checkoutSubmissions;
   result.networkCoverageComplete=observed?.pageIntercepted===true;
   Object.assign(result,await finishCase({
    closeWorker:async()=>{if(worker)worker.close();else diagnostic?.close();return !worker?.activeSession;},
    closeBrowser:async()=>{
     const processResult=context?await cleanupTaskBrowser(profilePath(context)):{verified:true};
     const network=worker?.state.browserNetwork;
     result.lifecycleComplete=!!network&&network.proxyClosed&&network.driverClosed&&network.cleanupErrors===0&&processResult.verified;
     if(result.lifecycleComplete&&!network.browserClosed){network.browserClosed=true;worker.save();diagnostic.emit('closed');}
     return processResult.verified&&(!network||network.proxyClosed&&network.driverClosed&&network.cleanupErrors===0);
    },
    revoke:async()=>{
     if(credentialAudit){
      // Captured before SQL/file issuance; partial setup cannot hide credentials.
      // The repaired helper independently attempts SQL and HTTP for every entry.
      const audit=await auditCredentials({credentials:issuing,execute,request:fetchImpl});
      writePrivate(dir+'/credential-audit.json',audit);return audit.passed;
     }
     let revoked=true;
     // Covers a successful credential INSERT followed by a failed private-file
     // write. Scope is the unique company created by this case, never a prior job.
     if(context){try{
      const company=context.companyId.replaceAll("'","''"),at=new Date().toISOString();
      await execute(`UPDATE po_cart_worker_credentials SET status='revoked',revoked_at='${at}' WHERE status='active' AND worker_id IN (SELECT id FROM po_cart_worker_identities WHERE company_id='${company}');`);
     }catch{revoked=false;}}
     for(const name of ['one.json','two.json']){
      const file=dir+'/'+name;if(!existsSync(file))continue;
      try{
       await fixtureCredential({execute,file,action:'revoke'});
       const saved=readPrivate(file);if(!issuing.some(c=>c.credentialId===saved.credentialId))issuing.push(saved);
      }catch{revoked=false;}
     }
     for(const credential of issuing){
      try{
       const r=await fetch('http://127.0.0.1:5181/api/internal/po-cart-worker',{headers:{authorization:'Bearer '+credential.secret}});
       await r.body?.cancel();if(r.status!==401)throw Error();
      }catch{revoked=false;}
     }
     return revoked;
    }
   }));
   result.diagnosticWriterHealthy=diagnostic?.healthy()??spec.diagnosticMode==='off';
   evidence=inspectDiagnostics(diagnosticFile,spec.diagnosticMode,result.diagnosticWriterHealthy);
   result.evidenceHealthy=evidence.healthy;
   const ev=evidence.events,count=name=>ev.filter(e=>e.event===name).length;
   result.diagnosticModeVerified=spec.diagnosticMode==='off'?evidence.healthy:
    evidence.healthy&&count('form_ready')===(spec.diagnosticMode==='form'?result.additions:0);
   if(result.passed&&spec.diagnosticMode!=='off'){
    const provider=ev.filter(e=>e.event.startsWith('provider_'));
    const phases=spec.reader==='stagehand'?10:0;
    result.evidenceHealthy&&=provider.length===phases*4&&provider.every((e,i)=>e.event===['provider_reserved','provider_start','provider_headers','provider_complete'][i%4]
     &&e.phaseId===Math.floor(i/4)&&(i%4!==2||e.status===200))&&count('metadata_verdict')===phases/2;
    for(const name of ['quantity_filled','attempt_ack','click_dispatch','click_done','add_request','add_response','add_finished','proxy_add','proxy_forward','proxy_response','proxy_end'])result.evidenceHealthy&&=count(name)===3;
   }
   result.passed&&=result.evidenceHealthy&&result.diagnosticModeVerified&&result.cleanupVerified&&result.lifecycleComplete;
   if(!result.evidenceHealthy&&result.error==='none')result.error='evidence_failed';
   if(!result.passed)result.failure=classifyFailure({stage:result.stage,additions:result.additions,attempts:result.attempts,evidence});
   result.finishedAt=new Date().toISOString();result.elapsedMs=Date.parse(result.finishedAt)-Date.parse(result.startedAt);
  }
  onProgress(spec,index,result.passed);return result;
 };
}
