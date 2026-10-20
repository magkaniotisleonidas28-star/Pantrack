import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,lstatSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {legacySnapshot,validateLegacyTargets,closeLegacyBrowsers,acquireLegacyGuards,releaseLegacyGuards,verifyLegacyGuards,browserTargets,staleTarget} from '../scripts/po-cart-worker/legacy-profile-cleanup.mjs';
import {createLegacyAttempt,LegacyVerificationError} from '../scripts/po-cart-worker/legacy-profile-verification.mjs';
import {parseMaintenanceIdentity,analyzeMaintenanceSample} from '../scripts/po-cart-worker/maintenance-shutdown-observation.mjs';
import {writePrivate} from '../scripts/po-cart-worker/private-files.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex'),start='Thu Oct 15 01:00:00 2026';
const main=resolve(process.env.HOME??'','Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const auditPath=resolve('scripts/po-cart-worker/maintenance-observation-audit.py');
const pyEnv={...process.env,PYTHONDONTWRITEBYTECODE:'1'};
export async function runMaintenanceScenario(root,mode='transition'){
 mkdirSync(root,{recursive:true,mode:0o700});root=realpathSync(root);const profiles=join(root,'profiles');mkdirSync(profiles);
 const target=browserTargets[2];for(const t of [target,staleTarget])mkdirSync(join(profiles,t.profile));
 symlinkSync('fixture-'+target.pid,join(profiles,target.profile,'SingletonLock'));
 writeFileSync(join(profiles,target.profile+'.lock'),String(target.pid-2),{mode:0o600});writeFileSync(join(profiles,staleTarget.profile+'.lock'),'4303',{mode:0o600});
 const row=(pid,parent,command,fields={})=>({pid,parent,group:target.pid,state:'S',start,command,executable:main,...fields});
 const baseline=Array.from({length:9},(_,i)=>row(target.pid+i,i?target.pid:1,main+(i?' --type=renderer':'')+' --user-data-dir='+join(profiles,target.profile)));
 const idle=row(99999,1,'TOKEN_DO_NOT_LOG',{group:99999,executable:'/private/TOKEN_DO_NOT_LOG'});
 const world={time:0,shutdown:false,waitReads:0,phase:'strict',signals:[],gone:false,usedFault:false,canonicalFault:false};
 let active=baseline.map(p=>({...p})),guards=[],plan,rejection;
 const timeline=[],control={stopping:false};
 const writer=(path,value)=>{
  if(mode==='event_write'&&!world.usedFault&&value.events?.at(-1)?.kind==='signal_intent'){world.usedFault=true;throw Error('TOKEN_DO_NOT_LOG');}
  writePrivate(path,value);
 };
 const attempt=createLegacyAttempt(root,{policy:'simulated-maintenance-lifecycle',targets:[target],evidenceOrigin:'simulated'}, {write:writer});
 const saveObservation=value=>{
  if((mode==='sample_write'&&value.event==='sample'||mode==='decision_write'&&value.event==='decision'
   ||mode==='primary_and_write'&&world.shutdown&&value.event==='decision'&&value.outcome==='blocked')&&!world.usedFault){world.usedFault=true;throw Error('TOKEN_DO_NOT_LOG');}
  const ref=attempt.observation(value);timeline.push({type:'observation',reference:ref});
  if(world.intent&&value.event==='decision'){
   if(mode==='interrupt_after_recheck')control.stopping=true;
   if(mode==='source_after_recheck')world.sourceChanged=true;
  }
  return ref;
 };
 const event=value=>{
  attempt.event(value);timeline.push({type:'event',event:value});
  if(value.kind==='signal_intent'){
   world.intent=true;
   if(mode==='exit_on_intent'){active=[];world.gone=true;}
   if(mode==='reused_on_intent')active[0].start='Fri Oct 16 01:00:00 2026';
   if(mode==='forbidden_on_intent')active.push(row(4303,1,'private TOKEN_DO_NOT_LOG',{group:4303}));
  }
 };
 const identity=()=>{
  let rows=active.map(p=>({...p}));
  if(world.phase==='shutdown'&&world.shutdown){
   world.waitReads++;
   if(['transition','zombie','surviving_changed'].includes(mode)&&!world.gone){
    rows=rows.map(p=>p.pid===target.pid+1?{...p,command:'(Chrome Helper)'}:p);
    if(mode==='zombie')rows[0]={...rows[0],command:'<defunct>',state:'Z'};
    if(world.waitReads%2===0&&mode!=='surviving_changed')rows=rows.filter(p=>p.pid!==target.pid+1);
   }
   if(['start_changed','primary_and_write','primary_and_audit'].includes(mode))rows[1].start='Fri Oct 16 01:00:00 2026';
   if(mode==='topology')rows[1].parent=777;
   if(mode==='new_member'&&world.waitReads===1)rows.push(row(90000,target.pid,'private TOKEN_DO_NOT_LOG'));
   if(mode==='pid4303')rows.push(row(4303,1,'private TOKEN_DO_NOT_LOG',{group:4303}));
   if(mode==='before_unavailable')throw Error('TOKEN_DO_NOT_LOG');
   if(mode==='after_unavailable'&&world.waitReads%2===0)throw Error('TOKEN_DO_NOT_LOG');
   if(mode==='reappearance'&&world.waitReads>=3)rows.push({...baseline[1]});
   if(mode==='canonical_survivor')world.canonicalFault=true;
  }
  if(mode==='reappearance'&&world.phase==='shutdown'&&world.waitReads===2){rows=rows.filter(p=>p.pid!==target.pid+1);active=active.filter(p=>p.pid!==target.pid+1);}
  return parseMaintenanceIdentity([...rows,idle].map(p=>`${p.pid} ${p.parent} ${p.group} ${p.state} ${p.start} ${p.command}`).join('\n'));
 };
 const metadata=()=>{
  let rows=active.map(p=>({...p}));
  if(world.phase==='shutdown'&&world.shutdown){
   if(mode==='metadata_unavailable')return 'malformed TOKEN_DO_NOT_LOG';
   if(mode==='metadata_missing'||['transition','zombie'].includes(mode))rows=rows.filter(p=>p.pid!==target.pid+1);
   if(mode==='zombie'&&!world.gone)rows[0]={...rows[0],executable:'<defunct>'};
   if(mode==='metadata4303')rows.push(row(4303,1,'private TOKEN_DO_NOT_LOG',{group:4303}));
  }
  return [...rows,idle].map(p=>`${p.pid} ${p.start} ${p.executable}`).join('\n');
 };
 const canonical=p=>{
  if((mode==='canonical_initial'||world.canonicalFault)&&p===main)return p+'-replaced';
  if(p==='<defunct>')throw Error('TOKEN_DO_NOT_LOG');return p;
 };
 const snapshot=options=>legacySnapshot({...options,identitySnapshot:identity,readExecutables:metadata,canonical,evidenceOrigin:'simulated'});
 const io={canonical:p=>p,now:()=>world.time,snapshot:options=>{world.phase='strict';return snapshot(options);},
  shutdownSnapshot:options=>{world.phase='shutdown';return snapshot({...options,phase:'shutdown'});},pause:async()=>{
   world.time+=1000;if(['transition','zombie'].includes(mode)){world.gone=true;active=[];}
   if(mode==='source')throw new LegacyVerificationError('source_changed');
   if(mode==='interrupt')throw new LegacyVerificationError('interrupted');
  },signal:(pid,signal)=>{
   world.signals.push({pid,signal,time:world.time});
   if(mode==='signal_denied')throw Object.assign(Error('TOKEN_DO_NOT_LOG'),{code:'EPERM'});
   if(mode==='signal_esrch'){active=[];world.gone=true;throw Object.assign(Error('TOKEN_DO_NOT_LOG'),{code:'ESRCH'});}
   if(signal==='SIGTERM'){world.shutdown=true;if(mode==='graceful'){active=[];world.gone=true;}}
   if(signal==='SIGKILL'&&mode!=='stuck'){active=active.filter(p=>p.pid!==pid);}
   if(mode==='surviving_changed'&&signal==='SIGTERM')active[1]={...active[1],command:'(Chrome Helper)'};
  }};
 try{
  attempt.stage('target_validation');
  const initialRows=parseMaintenanceIdentity([...baseline,idle].map(p=>`${p.pid} ${p.parent} ${p.group} ${p.state} ${p.start} ${p.command}`).join('\n'));
  const evidence={processes:initialRows.filter(p=>p.pid!==idle.pid).map(p=>({...p,profile:target.profile})),liveLocks:[{...staleTarget,kind:'worker'}]};
  const admitted=io.snapshot({captured:evidence.processes,root:profiles,record:saveObservation,forbiddenPids:[4303]});
  plan=validateLegacyTargets(evidence,admitted,{root:profiles,io,targets:[target],pid4303Absent:true});
  attempt.stage('exclusive_guards');guards=acquireLegacyGuards(profiles,[target]);
  attempt.stage('browser_shutdown');await closeLegacyBrowsers(plan,{root:profiles,io,control,record:event,recordObservation:saveObservation,
   checkSource:()=>{if(world.sourceChanged)throw new LegacyVerificationError('source_changed');verifyLegacyGuards(guards);}});
  attempt.state.passed=true;attempt.state.status='complete';
 }catch(error){rejection=error;attempt.fail(error);}
 finally{
  try{if(guards.length)releaseLegacyGuards(guards);}catch(error){attempt.fail(error);}
  if(mode==='primary_and_audit')attempt.fail(new LegacyVerificationError('audit_failed'));
  attempt.finish();writePrivate(root+'/timeline.json',timeline);
 }
 for(const item of timeline)if(item.type==='observation'){
  const content=readFileSync(join(root,item.reference),'utf8');assert.ok(!content.includes('TOKEN_DO_NOT_LOG'));assert.ok(!content.includes(main));assert.ok(!content.includes(profiles));
 }
 return {root,report:attempt.state,world,rejection,timeline};
}
function python(code,args=[]){const p=spawnSync('python3',['-c',code,auditPath,...args],{encoding:'utf8',env:pyEnv});assert.equal(p.status,0,p.stderr);return p.stdout;}
const load="import importlib.util,json,pathlib,sys\ns=importlib.util.spec_from_file_location('audit',sys.argv[1]);a=importlib.util.module_from_spec(s);s.loader.exec_module(a)\n";
// POSIX-only when run directly; the exported scenario stays importable on every platform.
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url&&process.platform==='win32'){console.log('SKIP po-cart-maintenance-lifecycle on Windows: requires POSIX symlinks/modes and python3.');process.exit(0);}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const sandbox=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-maintenance-lifecycle-')));let count=0;
 try{
  const proofs=[];
  for(const mode of ['transition','zombie','graceful','escalation','stuck','surviving_changed','start_changed','topology','new_member','pid4303','metadata4303',
   'metadata_missing','before_unavailable','after_unavailable','metadata_unavailable','canonical_initial','canonical_survivor','reappearance','source','interrupt',
   'sample_write','decision_write','primary_and_write','primary_and_audit','event_write','signal_denied','signal_esrch','exit_on_intent','reused_on_intent','forbidden_on_intent',
   'interrupt_after_recheck','source_after_recheck']){
   const proof=await runMaintenanceScenario(join(sandbox,mode),mode);proofs.push(proof);count++;
   assert.equal(proof.report.passed,['transition','zombie','graceful','escalation','signal_esrch','exit_on_intent'].includes(mode),mode);
   if(['transition','zombie','graceful'].includes(mode))assert.deepEqual(proof.world.signals.map(s=>[s.pid,s.signal]),[[30474,'SIGTERM']]);
   if(mode==='escalation'){assert.equal(proof.world.signals.length,10);assert.equal(proof.world.signals[1].time,5000);}
   if(mode==='stuck')assert.equal(proof.world.time,10000);
   if(['sample_write','decision_write','event_write','canonical_initial','exit_on_intent','reused_on_intent','forbidden_on_intent','interrupt_after_recheck','source_after_recheck'].includes(mode))assert.equal(proof.world.signals.length,0,mode);
   if(['surviving_changed','canonical_survivor'].includes(mode))assert.equal(proof.world.signals.length,1);
   if(mode==='primary_and_write'){assert.equal(proof.report.failure.category,'executable_identity_changed');assert.ok(proof.report.failures.some(f=>f.category==='evidence_write_failed'));}
   if(mode==='primary_and_audit'){assert.equal(proof.report.failure.category,'executable_identity_changed');assert.equal(proof.report.failures.at(-1).category,'audit_failed');}
  }
  const list=join(sandbox,'roots.json');writeFileSync(list,JSON.stringify(proofs.map(p=>p.root)));
  python(load+"for root in json.load(open(sys.argv[2])):\n a.audit_maintenance(root)\n try:a.audit_maintenance(root,require_collected=True);raise RuntimeError('simulated proof validated real maintenance')\n except AssertionError:pass\n",[list]);
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/po-cart-maintenance-transitions.json',import.meta.url),'utf8'));
  for(const trial of fixture.collected){assert.equal(analyzeMaintenanceSample(trial.sample).passed,true);assert.equal(analyzeMaintenanceSample({...trial.sample,phase:'strict'}).passed,false);}
  assert.equal(analyzeMaintenanceSample(fixture.historical.observation).passed,false);
  assert.equal(analyzeMaintenanceSample({...fixture.historical.observation,version:2,phase:'shutdown'}).passed,false);
  const fixturePath=resolve('tests/fixtures/po-cart-maintenance-transitions.json');
  python(load+"f=json.load(open(sys.argv[2]))\nfor c in f['collected']:\n assert a.decision(c['sample'])['passed'] is True\n assert a.decision(dict(c['sample'],phase='strict'))['passed'] is False\nassert a.decision(f['historical']['observation'])['passed'] is False\n",[fixturePath]);
  const complete=proofs[0];
  python(load+`import tempfile,shutil
original=pathlib.Path(sys.argv[2])
for mode in ['version','decision','start','signal','recheck','primary','order','absence','profile']:
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);shutil.copytree(original,root,dirs_exist_ok=True,symlinks=True)
  report=json.loads((root/'report.json').read_text());timeline=json.loads((root/'timeline.json').read_text())
  observations=[p for p in timeline if p['type']=='observation']
  if mode in ['version','start','absence','profile']:
   ref=next(p['reference'] for p in observations if json.loads((root/p['reference']).read_text())['event']=='sample')
   value=json.loads((root/ref).read_text())
   if mode=='version':value['version']=1
   if mode=='start':value['before'][0]['startedMs']+=1000
   if mode=='absence':value['after']=[]
   if mode=='profile':value['after'][0]['profile']=None
   (root/ref).write_text(json.dumps(value))
  if mode=='decision':
   ref=observations[1]['reference'];value=json.loads((root/ref).read_text());value['analysis']['passed']=False;(root/ref).write_text(json.dumps(value))
  if mode=='signal':next(p['event'] for p in timeline if p['type']=='event' and p['event']['kind']=='signal_sent')['pid']=4303
  if mode=='recheck':
   at=next(i for i,p in enumerate(timeline) if p['type']=='event' and p['event']['kind']=='signal_sent');timeline.insert(at-2,timeline.pop(at))
  if mode=='primary':report['failure']={'category':'forged'};report['failures']=[{'category':'original'}]
  if mode=='order':timeline[0],timeline[1]=timeline[1],timeline[0]
  (root/'report.json').write_text(json.dumps(report));(root/'timeline.json').write_text(json.dumps(timeline))
  try:a.audit_maintenance(root);raise RuntimeError('forged proof accepted: '+mode)
  except (AssertionError,KeyError):pass
`,[complete.root]);
  console.log(`PASS maintenance lifecycle: ${count} actual simulated lifecycles, strict signal ownership, bounded wait/escalation, terminal transitions, start/PID reuse and reappearance, membership/topology/incomplete reads, persist-before-decision and failure preservation; independent auditing, five retained real transitions and nine false-proof refusals. No real browsers or signals.`);
 }finally{rmSync(sandbox,{recursive:true,force:true});}
}
