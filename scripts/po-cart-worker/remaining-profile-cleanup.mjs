import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {browserTargets,staleTarget,loadHistoricalTargets,validateLegacyTargets,lockRecord,legacyIO,requireStalePidAbsent,
 verifyPopulation,verifyProfileDirectories,verifyProfileOwnership} from './legacy-profile-cleanup.mjs';
import {historicalProfileRoot} from './profile-preservation-preflight.mjs';
import {LegacyVerificationError} from './legacy-profile-verification.mjs';

export const remainingRoot='.sites-runtime/po-cart-workers/remaining-profile-cleanup-task-20261015';
export const remainingPolicy='fixed-remaining-profile-cleanup-20261015';
export const remainingTargets=Object.freeze(browserTargets.slice(1).map(t=>Object.freeze({...t})));
export const lockEvidence='.sites-runtime/po-cart-workers/legacy-verification-source-task-20261015/worker-locks-before.json';
export const lockEvidenceHash='84802b4c380f0b205d77c1a9952979da4986d50e1784e0553230dc40cd936701';
const refuse=()=>{throw new LegacyVerificationError('target_validation_failed');};
export function loadRemainingEvidence(){
 const evidence=loadHistoricalTargets(),bytes=readFileSync(lockEvidence);
 if(createHash('sha256').update(bytes).digest('hex')!==lockEvidenceHash)refuse();
 const locks=JSON.parse(bytes),oldLock=locks.find(l=>l.path.endsWith('/'+staleTarget.profile+'.lock'));
 if(!oldLock)refuse();
 const processes=evidence.processes.filter(p=>remainingTargets.some(t=>t.profile===p.profile));
 if(processes.length!==18)refuse();
 return {...evidence,processes,oldLock};
}
export function validateRemainingTargets(evidence,rows,{root=historicalProfileRoot,io=legacyIO}={}){
 if(evidence.processes.length!==18)refuse();
 const plan=validateLegacyTargets(evidence,rows,{root,io,targets:remainingTargets,pid4303Absent:true});
 const old=evidence.oldLock;
 // This lock is bound to the retained pre-repair observation, not just to a
 // newly observed file that happens to contain the same numeric PID.
 if(!old||plan.lock.ino!==old.ino||plan.lock.dev!==old.dev||plan.lock.mode!==old.mode
  ||plan.lock.mtimeMs!==old.mtimeNs/1e6||plan.lock.sha256!==old.sha256)refuse();
 return plan;
}
export function revalidateRemaining(plan,rows,{root=historicalProfileRoot,io=legacyIO}={}){
 requireStalePidAbsent(rows);
 if(verifyPopulation(rows,plan.captured,root).length!==18)refuse();
 verifyProfileDirectories(plan,io);verifyProfileOwnership(plan,{beforeShutdown:true});
 if(JSON.stringify(lockRecord(join(root,staleTarget.profile+'.lock')))!==JSON.stringify(plan.lock))refuse();
}
