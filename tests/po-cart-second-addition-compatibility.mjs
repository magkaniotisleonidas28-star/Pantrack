import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {investigationRoot,requireInvestigationSource,validateInvestigationPipeline,runInvestigation} from '../scripts/po-cart-worker/second-addition-investigation.mjs';
import {caseExecutor} from '../scripts/po-cart-worker/second-addition-case.mjs';
import {fixtureCredential} from '../scripts/po-cart-worker/credentials.mjs';
import {readPrivate} from '../scripts/po-cart-worker/private-files.mjs';

const root=mkdtempSync(join(tmpdir(),'pantrack-compatibility-'));
const expectedSource={files:1,sha256:'pipeline-source'},sourceSnapshot=()=>({...expectedSource});
const steps=['typecheck','test','db:check','build','db:migrate:local','test:local'];
const pipeline={passed:true,source:expectedSource,results:steps.map(id=>({id,passed:true,exitCode:0,sourceBefore:expectedSource.sha256,sourceAfter:expectedSource.sha256}))};
try{
 assert.equal(investigationRoot,'.sites-runtime/po-cart-workers/second-addition-compatibility-task-20261014');
 assert.deepEqual(validateInvestigationPipeline(pipeline,sourceSnapshot),expectedSource);
 for(const change of [p=>p.passed=false,p=>p.results.pop(),p=>p.results[0].exitCode=1,p=>p.results[1].sourceAfter='other',p=>p.source.files++]){
  const changed=structuredClone(pipeline);change(changed);assert.throws(()=>validateInvestigationPipeline(changed,sourceSnapshot));
 }
 for(const source of [undefined,{files:1,sha256:'changed'},{files:2,sha256:expectedSource.sha256}]){
  await assert.rejects(runInvestigation({root:join(root,'mismatch'),expectedSource:source,sourceSnapshot,runCase:async()=>assert.fail('No setup on mismatch')}));
  assert.equal(existsSync(join(root,'mismatch')),false,'Mismatch is refused before durable task creation');
 }
 // The initial CLI validation cannot mask a change before the internal creation check.
 let changed=false;
 const snapshot=()=>changed?{files:1,sha256:'other'}:sourceSnapshot();
 const validated=validateInvestigationPipeline(pipeline,snapshot);changed=true;
 await assert.rejects(runInvestigation({root:join(root,'race'),expectedSource:validated,sourceSnapshot:snapshot,runCase:async()=>assert.fail()}));
 assert.equal(existsSync(join(root,'race/task.json')),false);
 changed=false;
 const used=join(root,'used');
 const report=await runInvestigation({root:used,expectedSource,sourceSnapshot:snapshot,runCase:async(_spec,_index,assertSource)=>{
  assert.equal(readPrivate(used+'/task.json').slots.length,1);
  changed=true;assertSource();assert.fail('Changed setup must stop');
 }});
 assert.equal(report.status,'source_changed');assert.equal(report.results.length,1);
 const taskBefore=readFileSync(used+'/task.json'),reportBefore=readFileSync(used+'/report.json');changed=false;
 await assert.rejects(runInvestigation({root:used,expectedSource,sourceSnapshot:snapshot,runCase:async()=>assert.fail('No durable resume')}));
 assert.deepEqual(readFileSync(used+'/task.json'),taskBefore);assert.deepEqual(readFileSync(used+'/report.json'),reportBefore);
 for(const args of [['--resume'],['--root',root],['--restore-allowance'],['--help']]){
  const child=spawnSync(process.execPath,['scripts/po-cart-second-addition-check.mjs',...args],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/accepts no options or resumed slots/);
 }

 let seeded=0,ticked=0,constructed=0,checks=0;
 const api={browserDiagnostics:()=>({emit(){},close(){},healthy:()=>true}),LocalBrowserCartWorker:class{
  constructor(){constructed++;this.state={};}async tick(){ticked++;}close(){}
 }};
 const spec={diagnosticMode:'off',reader:'deterministic',layout:'rows'};
 const fixture={readSession:()=>({entries:[]}),credentialFiles:[],fixtureFile:'unused'};
 await caseExecutor(api,{stopping:false},{root,assertSource:()=>{throw Error('changed');},seedJob:async()=>{seeded++;return fixture;}})(spec,0);
 assert.equal(seeded,0,'Check immediately before fixture creation');
 await caseExecutor(api,{stopping:false},{root,assertSource:()=>{checks++;if(checks===2)throw Error('changed');},seedJob:async()=>{seeded++;return fixture;}})(spec,1);
 assert.equal(seeded,1);assert.equal(constructed,1);assert.equal(checks,2);assert.equal(ticked,0,'Check immediately before worker execution');

 // Capture a capability before either a partial SQL failure or a private-file failure.
 const credentialRoot='.sites-runtime/po-cart-workers/compatibility-credential-test-'+process.pid;
 mkdirSync(credentialRoot,{recursive:true,mode:0o700});
 try{
  for(const failSql of [true,false]){
   let captured,executed=false;
   const file=credentialRoot+(failSql?'/absent.json':'/directory');if(!failSql)mkdirSync(file);
   await assert.rejects(fixtureCredential({companyId:'fictional',file,onIssuing:c=>{captured=c;},execute:async()=>{
    assert.ok(captured?.secret);executed=true;if(failSql)throw Error('Partial insert failure');
   }}));
   assert.equal(executed,true);assert.ok(captured.workerId&&captured.credentialId&&captured.secret);
   if(failSql)assert.equal(existsSync(file),false);
  }
 }finally{rmSync(credentialRoot,{recursive:true,force:true});}
 assert.throws(()=>requireInvestigationSource(()=>({files:1,sha256:'other'}),expectedSource));
 console.log('PASS: fixed compatibility root, complete pipeline/source binding, creation race, setup/worker source checks, argument rejection, durable refusal and partial credential capture; zero browser jobs.');
}finally{rmSync(root,{recursive:true,force:true});}
