import {spawn,execFileSync} from 'node:child_process';
import {processControls} from './second-addition-cleanup.mjs';
import {writePrivate} from './private-files.mjs';

const timePattern='(\\d{4}-\\d\\d-\\d\\d) (\\d\\d:\\d\\d:\\d\\d) ([+-]\\d{4})';
const timed=new RegExp('^'+timePattern+'\\s+(.*)$');
const toTime=m=>Date.parse(m[1]+'T'+m[2]+m[3]);
// Retain only bounded numeric/enum evidence, never arbitrary power-log text.
export function inspectPowerLog(raw,since,observedAt){
 const rows=[];let watermark=null;
 for(const line of raw.split('\n')){
  const m=line.match(timed);if(!m)continue;
  const at=toTime(m);if(!Number.isFinite(at))throw Error('Power timestamp unavailable.');
  if(/: Showing all currently held IOKit power assertions/.test(m[4]))watermark=at;
  let event;
  if(/Display is turned on\b/.test(m[4]))event='display_on';
  else if(/Display is turned off\b/.test(m[4]))event='display_off';
  else if(/^Sleep\s|Entering Sleep|^DarkWake\s|^Wake\s/.test(m[4]))event='sleep_or_wake';
  if(event)rows.push({at,event});
 }
 const lastDisplay=rows.filter(r=>r.event.startsWith('display_')).at(-1);
 const events=rows.filter(r=>r.at>=Math.floor(since/1000)*1000);
 const complete=watermark!==null&&watermark>=Math.floor(observedAt/1000)*1000-2000&&watermark<=observedAt+2000;
 const displayOn=lastDisplay?.event==='display_on';
 return {complete,displayOn,watermark,lastDisplayAt:lastDisplay?.at??null,events:events.slice(-100),
  verified:complete&&displayOn&&events.length<=100&&!events.some(r=>r.event!=='display_on')};
}
export function assertionEvidence(raw,pid){
 const owned=raw.split('\n').filter(line=>new RegExp('^\\s*pid '+pid+'\\(caffeinate\\):').test(line));
 return {display:owned.some(line=>/\bPreventUserIdleDisplaySleep\b/.test(line)),
  system:owned.some(line=>/\bPreventUserIdleSystemSleep\b/.test(line))};
}
const command=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',maxBuffer:128*1024*1024,timeout:15000});
export const powerControls={...processControls,
 spawn:()=>spawn('/usr/bin/caffeinate',['-di','-w',String(process.pid)],{stdio:'ignore'}),
 assertions:()=>command('/usr/bin/pmset',['-g','assertions']),log:()=>command('/usr/bin/pmset',['-g','log'])};

export function displayOnPower({root,control,io=powerControls}){
 const report={version:1,startedAt:io.now(),samples:[],checks:[],failed:false};
 let child,owned,completion='pending';
 const save=()=>writePrivate(root+'/power.json',report);
 const fail=()=>{report.failed=true;control.powerFailed=true;control.stopping=true;control.worker?.requestStop();};
 const identity=()=>{
  const p=io.snapshot().find(p=>p.pid===child?.pid);
  if(!p||p.zombie||p.parent!==process.pid||p.identity!==owned?.identity||
   !/(?:^|\/)caffeinate -di -w /.test(p.command)||!p.command.endsWith(' '+process.pid))throw Error('Power assertion ownership unavailable.');
  return p;
 };
 const sample=()=>{
  try{
   identity();const assertions=assertionEvidence(io.assertions(),child.pid);
   const value={at:io.now(),...assertions,owned:true};
   if(!assertions.display||!assertions.system||report.samples.length>=1800)throw Error('Power assertion unavailable.');
   report.samples.push(value);save();return value;
  }catch{fail();save();throw Error('Display-on evidence unavailable.');}
 };
 const check=label=>{
  try{
   const raw=io.log(),at=io.now(),log=inspectPowerLog(raw,report.startedAt,at);sample();
   report.checks.push({label,at,...log});save();
   if(!log.verified)throw Error('Display-on evidence failed.');
   return log;
  }catch{fail();save();throw Error('Display-on evidence unavailable.');}
 };
 return {sample,check,async start(){
  try{
   child=io.spawn();child.once('error',()=>{completion='spawn_error';fail();});
   child.once('exit',()=>{completion='exit';if(!report.closing)fail();});
   // Spawn is asynchronous; wait only for our exact child/assertions to appear.
   const end=io.now()+5000;
   while(io.now()<end){
    const p=io.snapshot().find(p=>p.pid===child.pid);
    if(p){owned=p;report.owner={pid:p.pid,parent:p.parent,identity:p.identity};
     identity();const a=assertionEvidence(io.assertions(),p.pid);if(a.display&&a.system){check('before_browser');return;}}
    if(completion!=='pending')break;await io.pause();
   }
   throw Error('Power assertion unavailable.');
  }catch{fail();save();throw Error('Display-on assertion setup failed.');}
 },async close(){
  report.closing=true;let exited=false,assertionsCleared=false,processCleared=false;
  try{
   if(child){
    if(completion==='pending'){identity();io.signal(child.pid,'SIGTERM');}
    const end=io.now()+5000;
    while(completion==='pending'&&io.now()<end)await io.pause();
    if(completion==='pending'){identity();io.signal(child.pid,'SIGKILL');
     const end=io.now()+5000;while(completion==='pending'&&io.now()<end)await io.pause();}
    exited=completion==='exit';processCleared=!io.snapshot().some(p=>p.pid===child.pid);
    const a=assertionEvidence(io.assertions(),child.pid);assertionsCleared=!a.display&&!a.system;
   }else{exited=processCleared=assertionsCleared=true;}
  }catch{}
  report.cleanup={exited,processCleared,assertionsCleared,verified:exited&&processCleared&&assertionsCleared};
  if(!report.cleanup.verified)fail();report.finishedAt=io.now();save();return report.cleanup;
 }};
}
