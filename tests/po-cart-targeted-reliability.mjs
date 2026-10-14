import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {targetedCases,targetedTiming,callbackOffsetsMs} from '../scripts/po-cart-worker/targeted-timing.mjs';
import {writePrivate} from '../scripts/po-cart-worker/private-files.mjs';
await build({entryPoints:['scripts/po-cart-worker/browser-adapter.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/targeted-reliability-test.mjs',logLevel:'silent'});
const {LocalBrowserCartWorker}=await import('../.sites-runtime/targeted-reliability-test.mjs');
const cases=targetedCases();assert.equal(cases.length,24);assert.equal(new Set(cases.map(c=>[c.profile,c.mode,c.diagnosticMode,c.layout].join('/'))).size,24);
for(const key of ['layout','mode'])for(const value of new Set(cases.map(c=>c[key])))assert.equal(cases.filter(c=>c[key]===value).length,12);
assert.equal(cases.filter(c=>c.firstBeginTargetMs===19750).length,6);assert.equal(cases.filter(c=>c.firstBeginTargetMs===20250).length,6);
let clock=0;const sleeps=[],timing=targetedTiming(cases.find(c=>c.profile==='uneven'&&c.mode==='stagehand'),{now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;}});
timing.claimed();
for(const phase of ['baseline:Extraction','baseline:Metadata','product:DEMO-COFFEE:Extraction','product:DEMO-COFFEE:Metadata'])await timing.beforeRequest({phase});
assert.deepEqual(timing.report().callbackOffsetsMs,callbackOffsetsMs);await timing.beforeBegin();assert.equal(clock,16000);
clock+=500;await timing.beforeBegin();assert.equal(clock,16500,'Only the first begin is delayed');assert.equal(timing.report().timingMet,true);
const late=targetedTiming(cases[0],{now:()=>clock,sleep:async()=>{throw Error('No sleep for a missed target');}});late.claimed();clock+=17000;await late.beforeBegin();assert.equal(late.report().timingMet,false,'Missed timing cannot pass');
const boundary=targetedTiming(cases.find(c=>c.profile==='heartbeat'),{now:()=>clock,sleep:async ms=>{clock+=ms;}});boundary.claimed();await boundary.beforeBegin();assert.equal(boundary.report().heartbeatTimingMet,false);clock+=250;boundary.heartbeat();assert.equal(boundary.report().timingMet,true);
const aborted=new AbortController();aborted.abort();await assert.rejects(timing.beforeRequest({phase:'next',signal:aborted.signal}));
const root=mkdtempSync(join(tmpdir(),'pantrack-targeted-'));
try{
 const credentialFile=join(root,'credential.json');writePrivate(credentialFile,{workerId:'fictional-targeted-worker'});
 for(const mode of ['off','passive','form']){
  const diagnosticFile=join(root,mode+'.jsonl'),w=new LocalBrowserCartWorker({credentialFile,journalFile:join(root,mode+'.json'),fixtureFile:'unused',diagnosticFile,diagnosticMode:mode});
  assert.equal(w.diagnosticMode,mode);assert.equal(w.diagnostic.enabled,mode!=='off');assert.equal(existsSync(diagnosticFile),mode!=='off');w.close();
 }
 const ordinary=new LocalBrowserCartWorker({credentialFile,journalFile:join(root,'ordinary.json'),fixtureFile:'unused'});assert.equal(ordinary.diagnosticMode,'off');ordinary.close();
 console.log('PASS: balanced 24-job targeted matrix, recorded callback schedule, heartbeat boundaries, missed-target rejection, aborts and diagnostic mode compatibility.');
}finally{rmSync(root,{recursive:true,force:true});}
