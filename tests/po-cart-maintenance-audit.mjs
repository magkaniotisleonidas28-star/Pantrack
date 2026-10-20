import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,unlinkSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runMaintenanceScenario} from './po-cart-maintenance-lifecycle.mjs';
import {analyzeMaintenanceSample} from '../scripts/po-cart-worker/maintenance-shutdown-observation.mjs';

// POSIX-only: models macOS process maintenance with symlinked profiles, file modes and python3 auditors.
if(process.platform==='win32'){console.log('SKIP po-cart-maintenance-audit on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
// Adversarial checks of the independent maintenance proof auditor. Every proof
// starts as an actual simulated lifecycle (injected process reads, signals and
// clocks; no real browser) and each forgery mutates an isolated copy.
const auditPath=resolve('scripts/po-cart-worker/maintenance-observation-audit.py');
const modes=['transition','zombie','graceful','escalation','stuck','surviving_changed','start_changed','topology','new_member','pid4303','metadata4303',
 'metadata_missing','before_unavailable','after_unavailable','metadata_unavailable','canonical_initial','canonical_survivor','reappearance','source','interrupt',
 'sample_write','decision_write','primary_and_write','primary_and_audit','event_write','signal_denied','signal_esrch','exit_on_intent','reused_on_intent','forbidden_on_intent',
 'interrupt_after_recheck','source_after_recheck'];
const runner=`import importlib.util,json,sys
s=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
out=[]
for case in json.load(open(sys.argv[2])):
 try:out.append(dict(ok=True,value=a.decision(case['sample']) if 'sample' in case else a.audit_maintenance(case['root'],require_collected=case['collected'])))
 except Exception as e:out.append(dict(ok=False,type=type(e).__name__,message=str(e)))
print(json.dumps(out))
`;
const env={...process.env};delete env.PYTHONOPTIMIZE;
function audit(cases,{optimize=false}={}){
 const file=join(sandbox,'cases-'+Math.random().toString(16).slice(2)+'.json');writeFileSync(file,JSON.stringify(cases));
 const p=spawnSync('python3',['-I','-B',...(optimize?['-O']:[]),'-c',runner,auditPath,file],{encoding:'utf8',env});
 assert.equal(p.status,0,p.stderr);assert.ok(!p.stdout.includes('TOKEN_DO_NOT_LOG')&&!p.stderr.includes('TOKEN_DO_NOT_LOG'));
 return JSON.parse(p.stdout);
}
const read=(root,ref)=>JSON.parse(readFileSync(join(root,ref),'utf8'));
const write=(root,ref,value)=>writeFileSync(join(root,ref),JSON.stringify(value));
const events=timeline=>timeline.filter(e=>e.type==='event').map(e=>e.event);
const at=(timeline,kind,n=0)=>timeline.map((e,i)=>e.type==='event'&&e.event.kind===kind?i:-1).filter(i=>i>=0)[n];
// Keep the durable report event log consistent with an edited timeline, so a
// refusal is attributable to the forged claim rather than an incidental mismatch.
const syncEvents=(report,timeline)=>{report.events=events(timeline).map((e,i)=>({...e,at:report.events[Math.min(i,report.events.length-1)].at}));};
let sandbox,copies=0;
function forge(proof,fn){
 const root=join(sandbox,'forged-'+String(++copies).padStart(3,'0'));cpSync(proof.root,root,{recursive:true,verbatimSymlinks:true});
 const report=read(root,'report.json'),timeline=read(root,'timeline.json');
 fn({root,report,timeline,obs:ref=>read(root,ref),save:(ref,value)=>write(root,ref,value)});
 write(root,'report.json',report);write(root,'timeline.json',timeline);return root;
}
// Remove observations and renumber the rest, as a forger hiding evidence would.
function dropObservations(root,drop){
 const report=read(root,'report.json'),timeline=read(root,'timeline.json').filter(e=>!(e.type==='observation'&&drop.includes(e.reference)));
 const map=new Map();for(const e of timeline)if(e.type==='observation')map.set(e.reference,'observations/'+String(map.size+1).padStart(6,'0')+'.json');
 const fix=ref=>map.get(ref)??ref,values=[...map].map(([old,ref])=>[ref,read(root,old)]);
 for(const name of readdirSync(join(root,'observations')))unlinkSync(join(root,'observations',name));
 for(const [ref,value] of values){
  for(const holder of [value,value.failure,value.analysis?.failure])if(holder?.sampleReference)holder.sampleReference=fix(holder.sampleReference);
  for(const holder of [value.failure,value.analysis?.failure])if(holder?.reference)holder.reference=fix(holder.reference);
  write(root,ref,value);
 }
 for(const e of timeline)if(e.type==='observation')e.reference=fix(e.reference);
 for(const f of [...report.failures,report.failure].filter(Boolean))if(f.reference)f.reference=fix(f.reference);
 if(report.lastObservation)report.lastObservation=fix(report.lastObservation);
 write(root,'report.json',report);write(root,'timeline.json',timeline);
}
const samples=(root,timeline)=>timeline.map((e,i)=>({i,e})).filter(({e})=>e.type==='observation').map(({i,e})=>({i,ref:e.reference,value:read(root,e.reference)}));

sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-maintenance-audit-')));
try{
 const proofs={};
 for(const mode of modes)proofs[mode]=await runMaintenanceScenario(join(sandbox,'proof-'+mode),mode);

 // 1. Every actual lifecycle proof, including valid partial failures, remains
 // auditable; none can satisfy the collected-evidence requirement.
 const valid=audit(modes.flatMap(mode=>[{root:proofs[mode].root,collected:false},{root:proofs[mode].root,collected:true}]));
 modes.forEach((mode,i)=>{
  const [plain,collected]=[valid[2*i],valid[2*i+1]],report=proofs[mode].report;
  assert.equal(plain.ok,true,mode+': '+plain.message);
  assert.equal(plain.value.completed,report.passed,mode);assert.deepEqual(plain.value.primaryFailure,report.failure??null,mode);
  assert.deepEqual([collected.ok,collected.type,collected.message],[false,'AssertionError','Simulated proof cannot validate real maintenance'],mode);
 });

 // 2. Forged or contradictory proofs. Each names the refusal it must produce.
 const p=proofs,cases=[];
 const add=(name,root,message,collected=false)=>cases.push({name,root,message,collected});
 const first=(list,pred)=>list.find(pred);
 // Report/completion/primary-failure claims.
 add('report version downgrade',forge(p.graceful,({report})=>{report.version=1;}),'Report downgraded');
 add('passed with blocked status',forge(p.graceful,({report})=>{report.status='blocked';}),'False completion');
 add('passed without finish',forge(p.graceful,({report})=>{delete report.finishedAt;}),'False completion');
 add('passed as string',forge(p.start_changed,({report})=>{report.passed='false';}),'Invalid report completion state');
 add('blocked with complete status',forge(p.start_changed,({report})=>{report.status='complete';}),'Inconsistent report status');
 add('primary failure dropped',forge(p.start_changed,({report})=>{delete report.failure;}),'Primary failure missing or invented');
 add('primary failure invented',forge(p.graceful,({report})=>{report.passed=false;report.status='blocked';report.failure={category:'exit_timeout',phase:'browser_shutdown'};}),'Primary failure missing or invented');
 add('failures erased',forge(p.start_changed,({report})=>{report.failure=null;report.failures=[];}),'Blocked decision missing from failures');
 add('primary failure relabeled',forge(p.start_changed,({report})=>{report.failure.category=report.failures[0].category='exit_timeout';}),'Primary failure contradicts its evidence');
 add('primary replaced by later audit failure',forge(p.primary_and_audit,({report})=>{report.failures.reverse();report.failure=report.failures[0];}),'Primary failure contradicts its evidence');
 add('primary replaced by later write failure',forge(p.primary_and_write,({report})=>{report.failures.reverse();report.failure=report.failures[0];}),'Primary failure contradicts its evidence');
 add('secondary failure dangling reference',forge(p.primary_and_audit,({report})=>{report.failures[1].reference='observations/000099.json';}),'Missing failure evidence');
 add('failure references out of order',forge(p.primary_and_audit,({report})=>{report.failures[0].reference=report.failure.reference='observations/000010.json';report.failures[1].reference='observations/000001.json';}),'Failure evidence out of order');
 add('targets erased',forge(p.sample_write,({report})=>{report.targets=[];}),'Invalid maintenance targets');
 add('target profile swapped',forge(p.graceful,({report,timeline})=>{
  const profile='a'.repeat(64);report.targets[0].profile=profile;timeline[at(timeline,'browser_closed')].event.profile=profile;syncEvents(report,timeline);
 }),'Captured targets do not match report targets');
 // Evidence completeness, references and origin.
 add('timeline truncated',forge(p.start_changed,({report,timeline})=>{timeline.splice(-2);for(const f of report.failures)delete f.reference;delete report.failure.reference;}),'Observation evidence truncated');
 add('timeline emptied',forge(p.start_changed,({report,timeline})=>{timeline.length=0;for(const f of report.failures)delete f.reference;delete report.failure.reference;}),'Observation evidence truncated');
 add('refusal hidden in unreferenced file',forge(p.start_changed,({report,timeline})=>{
  timeline.splice(-2);for(const f of report.failures)delete f.reference;delete report.failure.reference;report.lastObservation=timeline.filter(e=>e.type==='observation').at(-1).reference;
 }),'Unreferenced observation evidence');
 add('symlinked observation',forge(p.graceful,({root})=>{
  const ref='observations/000003.json';writeFileSync(join(root,'shadow.json'),readFileSync(join(root,ref)));unlinkSync(join(root,ref));symlinkSync('../shadow.json',join(root,ref));
 }),'Unsafe evidence file');
 add('sample origin relabeled',forge(p.graceful,({timeline,obs,save})=>{const ref=timeline[0].reference,v=obs(ref);v.evidenceOrigin='collected';save(ref,v);}),'Evidence origin changed');
 add('report relabeled collected',forge(p.graceful,({report})=>{report.evidenceOrigin='collected';}),'Evidence origin changed',true);
 add('forbidden PID list dropped',forge(p.transition,({root,timeline,save})=>{
  for(const s of samples(root,timeline))if(s.value.event==='sample'){s.value.forbiddenPids=[];save(s.ref,s.value);}
 }),'Forbidden PID list changed');
 add('decision bound to wrong sample',forge(p.graceful,({timeline,obs,save})=>{const ref=timeline[3].reference,v=obs(ref);v.sampleReference=timeline[0].reference;save(ref,v);}),'Decision without preceding persisted input');
 add('unproved admission enrichment',forge(p.graceful,({root,timeline,save})=>{
  const list=samples(root,timeline).filter(s=>s.value.event==='sample'),enriched=list.findIndex(s=>'executableHash' in s.value.baseline[0]);
  assert.ok(enriched>0,'proof enriches its admission baseline');
  for(const s of list.slice(enriched)){s.value.baseline[1].executableHash='b'.repeat(64);save(s.ref,s.value);}
 }),'Unproved admission field');
 // Decisions.
 add('blocked decision failure relabeled',forge(p.start_changed,({timeline,obs,save})=>{const ref=timeline.at(-1).reference,v=obs(ref);assert.equal(v.outcome,'blocked');v.failure.category='exit_timeout';save(ref,v);}),'Decision failure contradicts analysis');
 add('verified decision carries failure',forge(p.graceful,({timeline,obs,save})=>{const ref=timeline[1].reference,v=obs(ref);assert.equal(v.outcome,'verified');v.failure={category:'exit_timeout',phase:'reconciliation'};save(ref,v);}),'Verified decision carries a failure');
 // Signals.
 add('report event log forged',forge(p.graceful,({report})=>{report.events.splice(2,0,{kind:'signal_sent',pid:4303,identity:report.events[0].identity,signal:'SIGKILL',at:report.events[0].at});}),'Report events differ from timeline');
 add('report event log erased',forge(p.graceful,({report})=>{report.events=[];}),'Report events differ from timeline');
 add('unrecorded event without write failure',forge(p.graceful,({report})=>{report.events.push({...report.events.at(-1)});}),'Report events differ from timeline');
 add('unrecorded final event forged',forge(p.event_write,({report,timeline})=>{
  assert.equal(report.events.length,events(timeline).length+1);report.events.at(-1).pid=4303;
 }),'Forbidden or absent signal target');
 add('stray temporary observation without write failure',forge(p.graceful,({root})=>{writeFileSync(join(root,'observations','000015.json.'+'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12)+'.tmp'),'{}');}),'Unexpected observation file');
 add('signal kind changed',forge(p.graceful,({report,timeline})=>{timeline[at(timeline,'signal_intent')].event.signal=timeline[at(timeline,'signal_sent')].event.signal='SIGSTOP';syncEvents(report,timeline);}),'Signal identity/kind changed');
 add('TERM to helper',forge(p.escalation,({report,timeline})=>{
  const i=at(timeline,'signal_intent',1),pid=timeline[i].event.pid;assert.notEqual(pid,report.targets[0].pid);
  for(const e of events(timeline))if(e.pid===pid&&e.signal==='SIGKILL')e.signal='SIGTERM';syncEvents(report,timeline);
 }),'TERM to a helper');
 add('signal with pending unverified sample',forge(p.graceful,({report,timeline})=>{
  const i=at(timeline,'signal_sent');assert.equal(timeline[i+1].type,'observation');timeline.splice(i+1,0,...timeline.splice(i,1));syncEvents(report,timeline);
 }),'Signal with unverified pending evidence');
 add('duplicate TERM instead of KILL',forge(p.escalation,({report,timeline})=>{
  const leader=report.targets[0].pid;let changed=0;
  for(const e of events(timeline))if(e.pid===leader&&e.signal==='SIGKILL'){e.signal='SIGTERM';changed++;}
  assert.equal(changed,2);syncEvents(report,timeline);
 }),'Duplicate signal intent');
 add('TERM result hidden',forge(p.escalation,({report,timeline})=>{timeline.splice(at(timeline,'signal_sent'),1);syncEvents(report,timeline);}),'Dangling signal intent');
 add('signal_not_sent reason changed',forge(p.signal_esrch,({report,timeline})=>{timeline[at(timeline,'signal_not_sent')].event.reason='denied';syncEvents(report,timeline);}),'Invalid signal result');
 add('unknown signal kind',forge(p.graceful,({report,timeline})=>{
  const e=timeline[at(timeline,'signal_sent')].event;timeline.splice(at(timeline,'signal_sent')+1,0,{type:'event',event:{...e,kind:'signal_group'}});syncEvents(report,timeline);
 }),'Unknown signal event');
 // Drop the pre-intent strict check, leaving only one from before the previous signal.
 let drop;const stale=forge(p.escalation,({root,timeline})=>{
  const i=at(timeline,'signal_intent',2),[s,d]=[timeline[i-2],timeline[i-1]];
  assert.ok(at(timeline,'signal_sent',1)<i-2&&s.type==='observation'&&read(root,s.reference).phase==='strict'&&read(root,d.reference).event==='decision');
  drop=[s.reference,d.reference];
 });
 dropObservations(stale,drop);
 add('intent without fresh strict check',stale,'Signal without a fresh strict decision');
 // Closure and absence.
 add('closure before proved absence',forge(p.transition,({report,timeline})=>{
  const closed=timeline.splice(at(timeline,'browser_closed'),1)[0];timeline.splice(at(timeline,'signal_sent')+1,0,closed);syncEvents(report,timeline);
 }),'Closure without proved absence');
 add('closure of another profile',forge(p.start_changed,({report,timeline})=>{
  timeline.push({type:'event',event:{kind:'browser_closed',pid:report.targets[0].pid+1,profile:report.targets[0].profile}});syncEvents(report,timeline);
 }),'False closure event');
 add('reappearance after strict absence',forge(p.escalation,({root,timeline,save})=>{
  const killed=timeline[at(timeline,'signal_sent',1)].event.pid,list=samples(root,timeline).filter(s=>s.value.event==='sample');
  const before=list.filter(s=>s.i<at(timeline,'signal_sent',1)).at(-1),after=list.filter(s=>s.i>at(timeline,'signal_sent',1)&&s.value.phase==='strict');
  assert.ok(!after[0].value.after.some(r=>r.pid===killed),'strict absence recorded');
  const target=after[1].value,decisionRef=timeline[after[1].i+1].reference,decision=read(root,decisionRef);
  for(const k of ['before','after','executables'])target[k].push(before.value[k].find(r=>r.pid===killed));
  decision.analysis=analyzeMaintenanceSample(target);assert.ok(decision.analysis.livePids.includes(killed));
  save(after[1].ref,target);save(decisionRef,decision);
 }),'Process reappeared');
 // Malformed proof input must be refused without leaking proof content.
 const malformed=forge(p.graceful,()=>{});write(malformed,'timeline.json',{});add('timeline not a list',malformed,'Malformed maintenance evidence');
 add('unsafe reference text',forge(p.graceful,({timeline})=>{timeline[0].reference='TOKEN_DO_NOT_LOG';}),'Invalid or repeated evidence reference');

 // Stripping assertions with python -O must not turn a stuck browser into a completion.
 const falseCompletion=({report})=>{report.passed=true;report.status='complete';report.failures=[];delete report.failure;};
 add('stuck browser claimed complete',forge(p.stuck,falseCompletion),'Missing final strict evidence');
 const optimized=forge(p.stuck,falseCompletion);
 // An uncommitted temporary write left by a recorded write failure stays acceptable.
 const tolerated=forge(p.event_write,({root})=>{writeFileSync(join(root,'observations','000007.json.'+'0'.repeat(8)+'-0000-4000-8000-'+'0'.repeat(12)+'.tmp'),'{}');});
 const [kept]=audit([{root:tolerated,collected:false}]);assert.equal(kept.ok,true,kept.message);
 const results=audit(cases.map(({root,collected})=>({root,collected})));
 const [stripped]=audit([{root:optimized,collected:false}],{optimize:true});
 const decisions=audit([{sample:{version:2,event:'sample',phase:'strict',complete:true,evidenceOrigin:'simulated',forbiddenPids:[4303],absentPids:[],baseline:[],before:['TOKEN_DO_NOT_LOG'],after:[],executables:[]}},
  {sample:'TOKEN_DO_NOT_LOG'}]);
 const wrong=[];
 cases.forEach((c,i)=>{
  const r=results[i];assert.ok(r.ok||!r.message.includes(sandbox),c.name);
  if(r.ok)wrong.push(c.name+': ACCEPTED');
  else if(r.type!=='AssertionError'||r.message!==c.message)wrong.push(c.name+': '+r.type+' '+JSON.stringify(r.message));
 });
 if(stripped.ok||stripped.message!=='Missing final strict evidence')wrong.push('python -O stuck browser claimed complete: '+(stripped.ok?'ACCEPTED':stripped.type+' '+stripped.message));
 const unavailable={passed:false,findings:[],livePids:[],absentPids:[],failure:{category:'process_observation_unavailable',phase:'reconciliation'}};
 for(const d of decisions)if(!d.ok||JSON.stringify(d.value)!==JSON.stringify(unavailable))wrong.push('malformed decision sample: '+(d.ok?JSON.stringify(d.value):d.type));
 assert.deepEqual(wrong,[],'forged or malformed proofs not refused as required:\n '+wrong.join('\n '));
 console.log(`PASS maintenance audit: ${modes.length} actual simulated lifecycles accepted and refused as collected evidence; ${cases.length+1} forged/contradictory proofs and two malformed samples refused with exact reasons, including under python -O. No real browsers or signals.`);
}finally{rmSync(sandbox,{recursive:true,force:true});}
