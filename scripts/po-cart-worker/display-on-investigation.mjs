import {fileHash} from './acceptance-gate.mjs';
import {readPrivate} from './private-files.mjs';
import {investigationCases,validateInvestigationPipeline} from './second-addition-investigation.mjs';
import {recordPreviewCleanup} from './second-addition-cleanup.mjs';

export const displayOnRoot='.sites-runtime/po-cart-workers/second-addition-display-on-task-20261015';
export const displayOnSuccess='not reproduced with display on; cause unresolved';
export const displayOnDelay=1500;
export const displayOnCases=()=>investigationCases().map(spec=>({...spec,delayMs:displayOnDelay,
 delayMechanism:spec.reader==='stagehand'?'mocked_provider_response':'application_get_response'}));
export function rejectDisplayOnArguments(args){if(args.length)throw Error('Single-use display-on investigation accepts no arguments, root overrides, retries or resumes.');}
export function displayOnPreparation(root,snapshot,now=Date.now()){
 const pipeline=readPrivate(root+'/pipeline-final.json');
 const source=validateInvestigationPipeline(pipeline,snapshot);
 const started=Date.parse(pipeline.startedAt),finished=Date.parse(pipeline.finishedAt);
 if(!Number.isFinite(started)||!Number.isFinite(finished)||started>finished||finished>now||now-started>2*60*60*1000)
  throw Error('Fresh task-owned preparation pipeline required.');
 for(const entry of pipeline.results)if(!entry.log||!entry.log.path.startsWith(root+'/pipeline-final-')||fileHash(entry.log.path)!==entry.log.sha256)
  throw Error('Task-owned pipeline evidence changed.');
 return source;
}

// Evidence/credential errors must never suppress preview or assertion cleanup.
export async function finishDisplayOnRun(report,{audit,closePreview,ports,closePower}){
 let credentialAudit={passed:false},preview={verified:false,failures:['observation_failed']},portResult={portsFree:false,failures:['observation_failed']},powerCleanup={verified:false};
 try{credentialAudit=await audit();}catch{}
 try{preview=await closePreview();}catch{}
 try{portResult=await ports();}catch{}
 try{powerCleanup=await closePower();}catch{}
 const result=recordPreviewCleanup({...report,credentialAudit},preview,portResult);
 result.powerCleanup=powerCleanup;
 if(!credentialAudit.passed||!powerCleanup.verified)result.status='cleanup_failed';
 return result;
}
