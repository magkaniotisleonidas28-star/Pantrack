import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,readFileSync,writeFileSync,lstatSync,existsSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {LegacyVerificationError,legacyFailure,parseLegacyExecutables,reconcileLegacyObservation,
 captureLegacyObservation,createLegacyAttempt} from '../scripts/po-cart-worker/legacy-profile-verification.mjs';
import {legacySnapshot,closeLegacyBrowsers,browserTargets,consumeMaintenance} from '../scripts/po-cart-worker/legacy-profile-cleanup.mjs';
import {writePrivate} from '../scripts/po-cart-worker/private-files.mjs';

const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-legacy-verification-')));
const root=join(sandbox,'profiles');mkdirSync(root);
for(const t of browserTargets)mkdirSync(join(root,t.profile));
const hash=s=>createHash('sha256').update(s).digest('hex'),start='Thu Oct 15 01:00:00 2026',executable='/test/Chrome';
const row=(pid,command,change={})=>({pid,parent:1,group:pid,zombie:false,state:'S',start,startedMs:Date.parse(start),
 startHash:hash(start),commandHash:hash(command),command,identity:hash(start+'\0'+command),...change});
const idle=row(99999,'private unrelated command token=DO_NOT_LOG');
const captured=browserTargets.map(t=>({...row(t.pid,executable+' --user-data-dir='+join(root,t.profile)),profile:t.profile,executable,startedMs:Date.parse(start)}));
const before=[...captured,idle];
const detailsFor=rows=>rows.map(p=>({pid:p.pid,start,startedMs:Date.parse(start),executable:p.pid===idle.pid?'/private/process':executable}));
const rawDetails=rows=>detailsFor(rows).map(p=>`${p.pid} ${p.start} ${p.executable}`).join('\n');
const reconcile=(change={})=>reconcileLegacyObservation({before,details:detailsFor(before),after:before,captured,root,...change});
const refused=(fn,category)=>assert.throws(fn,e=>e instanceof LegacyVerificationError&&e.category===category);
const newRoot=name=>{const p=join(sandbox,name);mkdirSync(p);return p;};
const read=p=>JSON.parse(readFileSync(p,'utf8'));
try{
 assert.equal(reconcile().find(p=>p.pid===30060).executable,executable);
 assert.deepEqual(parseLegacyExecutables(rawDetails(before)),detailsFor(before));
 for(const text of ['', 'malformed private token=DO_NOT_LOG',rawDetails(before)+'\n'+rawDetails(before)])refused(()=>parseLegacyExecutables(text),'executable_collection_failed');
 assert.equal(reconcile({after:[idle],details:detailsFor([idle])}).length,1,'Exit requires a successful final snapshot');
 assert.equal(reconcile({after:[idle]}).length,1,'Exit is valid even if metadata was captured before exit');
 refused(()=>reconcile({details:detailsFor([idle])}),'executable_evidence_incomplete');
 refused(()=>reconcile({after:[]}), 'process_observation_unavailable');
 refused(()=>reconcile({after:[...captured,{...idle,identity:'not-a-hash'}]}),'process_observation_unavailable');
 refused(()=>reconcile({before:[idle]}),'process_appeared');
 const reused={...captured[0],identity:hash('reused PID')};
 refused(()=>reconcile({after:[reused,...before.slice(1)]}),'identity_changed');
 refused(()=>reconcile({before:[reused,...before.slice(1)],after:[idle]}),'identity_changed');
 refused(()=>reconcile({before:[{...captured[0],parent:42},...before.slice(1)]}),'identity_changed');
 refused(()=>reconcile({before:[{...captured[0],group:42},...before.slice(1)]}),'identity_changed');
 refused(()=>reconcile({details:detailsFor(before).map(p=>p.pid===30060?{...p,start:'Fri Oct 16 01:00:00 2026'}:p)}),'executable_identity_changed');
 refused(()=>reconcile({after:[idle],details:detailsFor(before).map(p=>p.pid===30060?{...p,start:'Fri Oct 16 01:00:00 2026'}:p)}),'executable_identity_changed');
 refused(()=>reconcile({details:detailsFor(before).map(p=>p.pid===30060?{...p,executable:'/other/Chrome'}:p)}),'executable_identity_changed');
 refused(()=>reconcile({details:[...detailsFor(before),detailsFor(before)[0]]}),'executable_collection_failed');
 for(const intruder of [
  row(90000,'private child token=DO_NOT_LOG',{parent:30060,group:90000}),
  row(90000,'private group member token=DO_NOT_LOG',{group:30060}),
  row(90000,'Chrome --user-data-dir='+join(root,'unknown')),
 ]){
  refused(()=>reconcile({before:[...before,intruder],after:before}),'unexpected_membership');
  refused(()=>reconcile({after:[...before,intruder]}),'unexpected_membership');
 }
 for(const command of ['Chrome --user-data-dir='+root+'-sibling/personal','Chrome --user-data-dir=/personal/profile']){
  const other=row(90001,command);assert.equal(reconcile({before:[...before,other],after:[...before,other]}).length,before.length+1);
 }
 const evidence=[];let calls=0;
 const survivors=captureLegacyObservation({identitySnapshot:()=>calls++? [idle]:before,readExecutables:()=>rawDetails([idle]),captured,root,record:e=>evidence.push(e)});
 assert.equal(survivors.length,1);assert.equal(evidence[0].exited.length,3);
 assert.ok(!JSON.stringify(evidence).includes('DO_NOT_LOG'));assert.ok(!JSON.stringify(evidence).includes(root));assert.ok(!JSON.stringify(evidence).includes(executable));
 for(const failurePhase of ['before_snapshot','executable_snapshot','after_snapshot']){
  let count=0;const observed=[];
  assert.throws(()=>captureLegacyObservation({captured,root,identitySnapshot:()=>{
   if((failurePhase==='before_snapshot'&&count===0)||(failurePhase==='after_snapshot'&&count===1))throw Error('private command token=DO_NOT_LOG');count++;return before;
  },readExecutables:()=>{if(failurePhase==='executable_snapshot')throw Error('private command token=DO_NOT_LOG');return rawDetails(before);},record:value=>{observed.push(value);return 'observations/000001.json';}}),error=>{
   const f=legacyFailure(error);assert.equal(f.phase,failurePhase);assert.equal(f.reference,'observations/000001.json');return true;
  });
  assert.equal(observed[0].exited.length,0,'An unavailable final snapshot cannot claim exits');
  assert.ok(!JSON.stringify(observed).includes('DO_NOT_LOG'));
 }
 refused(()=>captureLegacyObservation({captured,root,identitySnapshot:()=>before,readExecutables:()=>rawDetails(before),record:()=>{throw Error('private filesystem error');}}),'evidence_write_failed');
 const unknown=legacyFailure(Object.assign(Error('token=DO_NOT_LOG'),{code:'EACCES'}),{phase:'browser_shutdown',category:'ownership_unverified'});
 assert.deepEqual(unknown,{category:'ownership_unverified',phase:'browser_shutdown',code:'EACCES'});

 // Integrate the bracketed collector with the actual shutdown loop. After its
 // first simulated TERM, executable-only disappearance must stop every signal.
 const dirs=[root,...browserTargets.map(t=>join(root,t.profile))].map(path=>{const s=lstatSync(path);return {path,dev:s.dev,ino:s.ino,mode:s.mode};});
 const plan={captured,directories:dirs,ownership:[]};
 const attemptRoot=newRoot('incomplete'),attempt=createLegacyAttempt(attemptRoot,{}),signals=[];
 let current=[...before],incomplete=false,time=0;
 const io={canonical:p=>p,now:()=>time,pause:async()=>{time+=1000;},signal:(pid,signal)=>{signals.push({pid,signal});incomplete=true;},
  snapshot:options=>legacySnapshot({...options,canonical:p=>p,identitySnapshot:()=>current,readExecutables:()=>rawDetails(incomplete?current.filter(p=>p.pid!==30060):current)})};
 attempt.stage('browser_shutdown');let rejection;
 try{await closeLegacyBrowsers(plan,{root,io,record:e=>attempt.event(e),recordObservation:e=>attempt.observation(e)});}catch(error){rejection=error;attempt.fail(error);}
 attempt.finish();assert.equal(rejection.category,'executable_evidence_incomplete');assert.deepEqual(signals,[{pid:30060,signal:'SIGTERM'}]);
 const report=read(join(attemptRoot,'report.json'));assert.equal(report.failure.pid,30060);assert.equal(report.failure.expectedIdentity,captured[0].identity);
 assert.equal(report.failure.observedIdentity,captured[0].identity);assert.match(report.failure.reference,/^observations\/\d{6}\.json$/);
 assert.equal(read(join(attemptRoot,report.failure.reference)).outcome,'blocked');
 assert.ok(!JSON.stringify(report).includes('DO_NOT_LOG'));

 // An actual exit between the two identity reads proceeds to the next captured
 // browser, without escalating or adopting any process.
 const exits=[];current=[...before];let pendingExit=null;
 const exitIO={...io,signal:(pid,signal)=>{exits.push({pid,signal});pendingExit=pid;},snapshot:options=>legacySnapshot({...options,canonical:p=>p,
  identitySnapshot:()=>current,readExecutables:()=>{if(pendingExit){current=current.filter(p=>p.pid!==pendingExit);pendingExit=null;}return rawDetails(current);}})};
 const exitAttempt=createLegacyAttempt(newRoot('split-exit'),{});
 await closeLegacyBrowsers(plan,{root,io:exitIO,recordObservation:e=>exitAttempt.observation(e)});assert.deepEqual(exits,browserTargets.map(t=>({pid:t.pid,signal:'SIGTERM'})));
 const interrupted={stopping:true};await assert.rejects(closeLegacyBrowsers(plan,{root,io:exitIO,control:interrupted}),e=>e.category==='interrupted');
 const deniedIO={...io,snapshot:()=>before,signal:()=>{throw Object.assign(Error('token=DO_NOT_LOG'),{code:'EPERM'});}};
 await assert.rejects(closeLegacyBrowsers(plan,{root,io:deniedIO}),e=>e.category==='signal_failed'&&e.context.pid===30060&&legacyFailure(e).code==='EPERM');
 const stuckIO={...io,snapshot:()=>before,signal:()=>{},now:()=>time,pause:async()=>{time+=1000;}};time=0;
 await assert.rejects(closeLegacyBrowsers(plan,{root,io:stuckIO}),e=>e.category==='exit_timeout'&&e.context.pid===30060);assert.equal(time,10000);

 const secondary=createLegacyAttempt(newRoot('secondary'),{});secondary.stage('browser_shutdown');
 secondary.fail(new LegacyVerificationError('identity_changed',{pid:30060,expectedIdentity:captured[0].identity,observedIdentity:hash('reused')}));
 secondary.fail(new LegacyVerificationError('guard_release_failed'),{phase:'guard_release'});secondary.finish();
 assert.equal(secondary.state.failure.category,'identity_changed');assert.deepEqual(secondary.state.failures.map(f=>f.category),['identity_changed','guard_release_failed']);
 const failingRoot=newRoot('write-failure'),failing=createLegacyAttempt(failingRoot,{}, {write:()=>{throw Object.assign(Error('private token=DO_NOT_LOG'),{code:'ENOSPC'});}});
 failing.fail(new LegacyVerificationError('identity_changed',{pid:30060}));refused(()=>failing.finish(),'evidence_write_failed');
 const fallback=read(join(failingRoot,'failure-report.json'));assert.equal(fallback.failure.category,'identity_changed');assert.equal(fallback.failures[1].category,'evidence_write_failed');
 assert.ok(!JSON.stringify(fallback).includes('DO_NOT_LOG'));
 failing.fail(new LegacyVerificationError('guard_release_failed'),{phase:'guard_release'});refused(()=>failing.finish(),'evidence_write_failed');
 const laterFallback=read(join(failingRoot,'failure-report-000002.json'));assert.equal(laterFallback.failure.category,'identity_changed');
 assert.ok(laterFallback.failures.some(f=>f.category==='guard_release_failed'));
 const stopped=createLegacyAttempt(newRoot('event-write-failure'),{}, {write:()=>{throw Error('private write error');}});let signaled=false;
 try{stopped.stage('browser_shutdown');signaled=true;}catch{}assert.equal(signaled,false);assert.equal(stopped.state.failure.category,'evidence_write_failed');
 const displacedRoot=newRoot('displaced'),displaced=createLegacyAttempt(displacedRoot,{});
 renameSync(join(displacedRoot,'report.json'),join(displacedRoot,'original.json'));writeFileSync(join(displacedRoot,'report.json'),'other attempt');
 refused(()=>displaced.finish(),'evidence_write_failed');assert.equal(readFileSync(join(displacedRoot,'report.json'),'utf8'),'other attempt');

 const consumedRoot=newRoot('consumed');consumeMaintenance(consumedRoot,{sha256:hash('source')});
 refused(()=>createLegacyAttempt(consumedRoot,{}),'invocation_consumed');assert.equal(existsSync(join(consumedRoot,'report.json')),false);
 // Two genuine competing launchers use only a temporary report root. Neither
 // imports the maintenance CLI or executes a process-control operation.
 const raceRoot=newRoot('race'),modulePath=resolve('scripts/po-cart-worker/legacy-profile-verification.mjs');
 const code=`import {createLegacyAttempt} from ${JSON.stringify(modulePath)};try{const a=createLegacyAttempt(process.argv[1],{});a.stage('target_validation');a.finish();process.exitCode=0;}catch{process.exitCode=2;}`;
 const launch=()=>new Promise(ok=>{const child=spawn(process.execPath,['--input-type=module','-e',code,raceRoot],{stdio:'ignore'});child.on('exit',ok);});
 assert.deepEqual((await Promise.all([launch(),launch()])).sort(),[0,2]);assert.ok(read(join(raceRoot,'report.json')).attemptId);
 assert.equal(existsSync(join(raceRoot,'task.json')),false);
 console.log('PASS legacy verification: bracketed exits versus incomplete metadata, transient descendants/PID reuse, exact failure evidence and privacy, stop-before-next-signal, timeout/interruption/signal failures, exclusive concurrent reports, immutable consumption and evidence-write fallback; simulated processes only.');
}finally{rmSync(sandbox,{recursive:true,force:true});}
