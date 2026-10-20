import {createHash} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {dirname} from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');
export const lifecycleStages=Object.freeze(['executable','proxy','port','spawn','startup','baseline','shutdown','observe','dispose','child_exit','proxy_close','report']);

// These are the existing startup admission conditions, in the original order.
// This analyzer has no process-control capability and never authorizes signals.
export function startupDecision(sample){
 if(!sample.complete)return {kind:'rejected',condition:'incomplete_collection'};
 if(sample.members.length<3)return {kind:'rejected',condition:'insufficient_members'};
 const invalid=sample.members.find(p=>p.zombie||!p.exactProfile);
 if(invalid)return {kind:'rejected',condition:invalid.zombie?'zombie_member':'profile_argument_missing',pid:invalid.pid};
 for(const p of sample.members){
  const d=sample.metadata.find(d=>d.pid===p.pid);
  const reject=condition=>({kind:'rejected',condition,pid:p.pid});
  if(!d)return reject('metadata_missing');
  if(d.metadataIdentity!==p.identity)return reject('identity_metadata_mismatch');
  if(!d.executableAllowed)return reject('executable_not_allowed');
  if(d.canonicalError)return reject('executable_resolution_failed');
  if(d.executableHash!==d.canonicalHash)return reject('executable_not_canonical');
 }
 return {kind:'candidate'};
}

export function startupPopulationHash(sample){
 return hash(JSON.stringify(sample.members.map(p=>[p.pid,p.parent,p.group,p.identity,
  sample.metadata.find(d=>d.pid===p.pid)?.executableHash]).sort((a,b)=>a[0]-b[0])));
}

export function createLifecycleEvidence({caseId,now,saveCase}){
 const references=[];let sequence=0,stage='executable';
 const emit=(event,fields={})=>{
  const reference=`cases/${caseId}/lifecycle-${String(++sequence).padStart(4,'0')}.json`;
  saveCase(reference,{version:2,sequence,stage,event,atMono:now(),...fields});
  references.push(reference);return reference;
 };
 return {references,emit,get stage(){return stage;},get lastReference(){return references.at(-1);},
  enter(value){if(!lifecycleStages.includes(value)||lifecycleStages.indexOf(value)<lifecycleStages.indexOf(stage))throw Error('Invalid lifecycle phase');stage=value;return emit('enter');}};
}

export function writeEmergencyResult(path,value){
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
