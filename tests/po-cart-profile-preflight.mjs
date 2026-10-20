import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectHistoricalProfiles,historicalProfilesPreflight,requireHistoricalProfilesIdle} from '../scripts/po-cart-worker/profile-preservation-preflight.mjs';

const root=realpathSync(mkdtempSync(join(tmpdir(),'pantrack-profile-preflight-'))),a='a'.repeat(64),b='b'.repeat(64);
const identity='1'.repeat(64),idle={pid:123,parent:1,group:123,identity,command:'unrelated process'};
const inspect=(change={})=>inspectHistoricalProfiles({root,profiles:[a,b],locks:[],processes:[idle],...change});
const row=(command,change={})=>({...idle,command,...change});
try{
 assert.equal(inspect().passed,true);assert.equal(requireHistoricalProfilesIdle(()=>inspect()).status,'idle');
 for(const command of [
  'Chrome --user-data-dir='+join(root,a)+' --headless',
  'Chrome --type=renderer --user-data-dir='+join(root,a),
  'Chrome --user-data-dir '+join(root,a)+' --type=gpu-process',
 ]){
  const r=inspect({processes:[row(command)]});assert.equal(r.passed,false);assert.equal(r.status,'historical_profiles_active');assert.equal(r.processes[0].profile,a);
 }
 // Exact boundaries: a personal/sibling profile does not belong to this root.
 assert.equal(inspect({processes:[row('Chrome --user-data-dir='+root+'-other/'+a)]}).passed,true);
 assert.equal(inspect({processes:[row('Chrome --user-data-dir=/personal/profile')]}).passed,true);
 for(const path of [join(root,'not-a-known-profile'),root+'/'+a+'/../'+b,root+'/'+a+'suffix']){
  const r=inspect({processes:[row('Chrome --user-data-dir='+path)]});assert.equal(r.passed,false);assert.equal(r.processes[0].kind,'unknown_profile_reference');
 }
 const spaced=join(root,'path with spaces');
 assert.equal(inspectHistoricalProfiles({root:spaced,profiles:[a],locks:[],processes:[row('Chrome --user-data-dir='+join(spaced,a)+' --headless')]}).processes[0].profile,a);
 const zombie=inspect({processes:[row('Chrome --user-data-dir='+join(root,a),{zombie:true})]});assert.equal(zombie.passed,false);
 const locks=[{profile:a,kind:'worker',pid:123},{profile:b,kind:'singleton',pid:999}];
 const locked=inspect({locks});assert.equal(locked.passed,false);assert.equal(locked.liveLocks.length,1);assert.equal(locked.staleLocks,1);
 assert.equal(inspect({locks:locks.slice(1)}).passed,true);
 for(const change of [{profiles:['../private']},{profiles:[a,a]},{processes:[]},{processes:[{...idle,pid:-1}]},{processes:[{...idle,identity:'raw secret'}]},{locks:[{profile:a,kind:'worker',pid:0}]},{profiles:Array(10001).fill(a)}]){
  const r=inspect(change);assert.equal(r.passed,false);assert.equal(r.status,'observation_unavailable');
 }
 const privateText='private command credential secret';
 const report=inspect({processes:[row('Chrome --user-data-dir='+join(root,a)+' '+privateText)]});assert.ok(!JSON.stringify(report).includes(privateText));assert.ok(!JSON.stringify(report).includes(root));
 for(const check of [()=>report,()=>undefined,()=>({passed:true,status:'observation_unavailable'}),()=>{throw Error(privateText);}]){
  assert.throws(()=>requireHistoricalProfilesIdle(check),error=>!error.message.includes(privateText)&&/no invocation was consumed/.test(error.message));
 }
 let calls=0;
 const check=(snapshots,readProfiles=()=>({profiles:[a],locks:[]}))=>historicalProfilesPreflight({root,snapshot:()=>snapshots[calls++],readProfiles});
 for(const snapshots of [[[{...idle}], [row('Chrome --user-data-dir='+join(root,a))]],[[row('Chrome --user-data-dir='+join(root,a))],[idle]]]){
  calls=0;const r=check(snapshots);assert.equal(r.passed,false);assert.equal(r.processes.length,1);assert.equal(calls,2);
 }
 calls=0;const reused=check([[row('Chrome --user-data-dir='+join(root,a))],[row('Chrome --user-data-dir='+join(root,a),{identity:'2'.repeat(64)})]]);
 assert.equal(reused.processes.length,2,'PID reuse never erases either observation');
 calls=0;assert.equal(check([[idle],[idle]],()=>{throw Error(privateText);}).status,'observation_unavailable');
 assert.equal(historicalProfilesPreflight({snapshot:()=>{throw Error(privateText);}}).status,'observation_unavailable');

 // On-disk lock and symlink cases need POSIX symlinks (see po-cart-browser-network).
 if(process.platform!=='win32'){
 const disk=join(root,'disk'),profile=join(disk,a);mkdirSync(profile,{recursive:true});
 const worker=join(disk,a+'.lock');writeFileSync(worker,'123');symlinkSync('legacy-host-999',join(profile,'SingletonLock'));
 const before=createHash('sha256').update(readFileSync(worker)).digest('hex');
 const actual=historicalProfilesPreflight({root:disk,snapshot:()=>[idle]});assert.equal(actual.passed,false);assert.equal(actual.liveLocks[0].kind,'worker');assert.equal(actual.staleLocks,1);
 assert.equal(createHash('sha256').update(readFileSync(worker)).digest('hex'),before);assert.ok(lstatSync(join(profile,'SingletonLock')).isSymbolicLink());
 assert.equal(historicalProfilesPreflight({root:disk,snapshot:()=>[{...idle,pid:333}]}).passed,true,'Stale files are retained, not reclaimed');
 const link=join(root,'alias');symlinkSync(disk,link);assert.equal(historicalProfilesPreflight({root:link,snapshot:()=>[idle]}).status,'observation_unavailable');
 const dangling=join(root,'dangling');symlinkSync(join(root,'absent'),dangling);assert.equal(historicalProfilesPreflight({root:dangling,snapshot:()=>[idle]}).status,'observation_unavailable');
 assert.equal(historicalProfilesPreflight({root:join(root,'missing'),snapshot:()=>[idle]}).passed,true);
 writeFileSync(worker,privateText);assert.equal(historicalProfilesPreflight({root:disk,snapshot:()=>[idle]}).status,'observation_unavailable');
 rmSync(worker);symlinkSync(join(root,'outside'),worker);assert.equal(historicalProfilesPreflight({root:disk,snapshot:()=>[idle]}).status,'observation_unavailable');
 rmSync(worker);mkdirSync(join(disk,b));writeFileSync(join(disk,b,'SingletonLock'),'not a symlink');assert.equal(historicalProfilesPreflight({root:disk,snapshot:()=>[idle]}).status,'observation_unavailable');
 }

 // Inspect the actual executable order: argument refusal, read-only guard, then
 // pipeline/durable invocation/bundle/spawn. No SDK/browser is executed here.
 for(const [file,reject,pipeline] of [
  ['scripts/po-cart-ai-gate.mjs','rejectGateArguments(process.argv.slice(2))','const pipeline='],
  ['scripts/po-cart-second-addition-check.mjs','if(process.argv.length!==2)','const pipeline='],
  ['scripts/po-cart-second-addition-display-on-check.mjs','rejectDisplayOnArguments(process.argv.slice(2))','const expectedSource='],
 ]){
  const s=readFileSync(file,'utf8');assert.ok(s.indexOf(reject)<s.indexOf('requireHistoricalProfilesIdle();'));assert.ok(s.indexOf('requireHistoricalProfilesIdle();')<s.indexOf(pipeline));
 }
 for(const args of [['--cleanup'],['--root',root],['--help']]){
  const child=spawnSync(process.execPath,['scripts/po-cart-profile-preflight.mjs',...args],{encoding:'utf8'});assert.notEqual(child.status,0);assert.match(child.stderr,/accepts no arguments or cleanup actions/);
 }
 // Observable no-consumption behavior, without using any historical gate root.
 const invocation=join(root,'would-be-task.json');let created=false;
 try{requireHistoricalProfilesIdle(()=>report);created=true;writeFileSync(invocation,'{}');}catch{}
 assert.equal(created,false);assert.equal(readdirSync(root).includes('would-be-task.json'),false);
 console.log('PASS: exact/unknown/space-containing profile paths, orphan/helper/zombie and live/stale locks, unavailable/unsafe evidence, snapshot races/PID reuse, privacy, argument refusal and pre-consumption CLI order; no process signals or browser jobs.');
}finally{rmSync(root,{recursive:true,force:true});}
