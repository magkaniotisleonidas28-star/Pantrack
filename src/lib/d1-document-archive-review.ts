import {poId} from './purchase-order-contract';
import {archivePreparationEvidence} from './document-archive-preparation-contract';
import {archiveReviewQuery,archiveReviewDetailQuery,archiveReviewItem,archiveReviewReasons,type ArchiveReviewItem} from './document-archive-review-contract';
import {documentArchiveRequest,captureArchiveArtifact,captureArchiveManifest,DocumentArchiveError,archiveFail,type DocumentArchiveManifest} from './purchase-order-document-archive-contract';

const member="company_id=? AND user_id=? AND role IN ('owner','manager')";
type Row={id:string;company_id:string;actor_id:string;request_json:string;state:string;reason:string|null;requested_at:string;updated_at:string;
  active:number;manifest_json:string|null;artifact_json:string|null;last_check:string|null;last_checked_at:string|null};
type Event={id:string;at:string;payload_json:string};
// Append order determines the last retained check, even if two checks share a timestamp.
const checkWhere="o.company_id=i.company_id AND o.document_id=i.id AND (i.state!='ready' OR o.token IS NULL) AND json_extract(o.payload_json,'$.kind') IN ('object','read_unknown','write_unknown') AND json_extract(o.payload_json,'$.check.contract') IS NOT 'pantrack.issued-file-check.v1'";
const projection=`i.id,i.company_id,i.actor_id,i.request_json,i.state,i.reason,i.requested_at,i.updated_at,i.manifest_json,i.artifact_json,
  (i.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS active,
  (SELECT payload_json FROM document_archive_observations o WHERE ${checkWhere} ORDER BY o.rowid DESC LIMIT 1) AS last_check,
  (SELECT at FROM document_archive_observations o WHERE ${checkWhere} ORDER BY o.rowid DESC LIMIT 1) AS last_checked_at`;
const attention=`state!='ready' OR (last_check IS NOT NULL AND (json_extract(last_check,'$.kind')!='object'
  OR json_extract(last_check,'$.present') IS NOT 1
  OR json_extract(last_check,'$.reportedSize') IS NOT json_extract(artifact_json,'$.size')
  OR json_extract(last_check,'$.byteLength') IS NOT json_extract(artifact_json,'$.size')
  OR json_extract(last_check,'$.sha256') IS NOT json_extract(artifact_json,'$.sha256')))`;
const scope="i.company_id=? AND json_extract(i.request_json,'$.source.kind')=? AND (?='history' OR json_extract(i.request_json,'$.source.orderId')=?)";
function checkStatus(payload:unknown,manifest?:DocumentArchiveManifest):'issued'|'missing'|'damaged'|'unavailable'{
  const p=payload as {kind?:unknown;present?:unknown;reportedSize?:unknown;byteLength?:unknown;sha256?:unknown}|null;
  if(p?.kind!=='object')return 'unavailable';if(p.present===false)return 'missing';
  if(p.present!==true||!manifest)return 'unavailable';
  return p.reportedSize===manifest.size&&p.byteLength===manifest.size&&p.sha256===manifest.sha256?'issued':'damaged';
}
function capture(row:Row){
  const request=documentArchiveRequest.parse(JSON.parse(row.request_json));
  if(request.companyId!==row.company_id||!['reserved','prepared','held','ready'].includes(row.state))archiveFail('integrity');
  const manifest=row.artifact_json?captureArchiveArtifact(JSON.parse(row.artifact_json)):row.manifest_json?captureArchiveManifest(JSON.parse(row.manifest_json)):undefined;
  if(manifest&&(manifest.id!==row.id||manifest.companyId!==row.company_id||manifest.actorId!==row.actor_id||manifest.format!==request.format||manifest.requestedAt!==row.requested_at||manifest.source.kind!==request.source.kind||
    (request.source.kind==='draft'?(manifest.source.records[0].id!==request.source.orderId||manifest.source.records[0].revision!==request.source.revision):manifest.source.fingerprint!==request.source.fingerprint)))archiveFail('integrity');
  if((row.state==='ready')!==!!row.artifact_json)archiveFail('integrity');
  const reason=Object.hasOwn(archiveReviewReasons,row.reason??'')?row.reason as keyof typeof archiveReviewReasons:null;
  let status:ArchiveReviewItem['status']=row.state==='ready'?'issued':row.state==='held'?'held':row.active?'pending':'unconfirmed';
  if(row.last_check&&(row.state==='ready'||row.state==='held')){
    const observed=checkStatus(JSON.parse(row.last_check),manifest);if(observed!=='issued')status=observed;
  }
  const item=archiveReviewItem.parse({id:row.id,companyId:row.company_id,format:request.format,source:request.source.kind==='draft'?request.source:{kind:'history'},
    requestedAt:row.requested_at,updatedAt:row.updated_at,status,reason,issued:!!row.artifact_json,lastCheckedAt:row.last_checked_at});
  return {item,manifest};
}
function eventSummary(event:Event,manifest?:DocumentArchiveManifest){
  const p=JSON.parse(event.payload_json) as {kind?:unknown;reason?:unknown;signature?:unknown;size?:unknown};
  if(p.kind==='object')return ({issued:'The recorded file matched its saved contents.',missing:'The file was not found at this check.',damaged:'The file contents did not match at this check.',unavailable:'The file check did not return usable evidence.'})[checkStatus(p,manifest) as 'issued'|'missing'|'damaged'|'unavailable'];
  if(p.kind==='write_unknown')return 'Storage did not confirm whether the file was saved.';
  if(p.kind==='read_unknown')return 'Storage could not complete this file check.';
  if(p.kind==='source_check')return 'Source and access evidence was recorded before saving.';
  if(p.kind==='generation')return p.signature===manifest?.format&&typeof p.size==='number'&&p.size>0?'A file was generated for verification.':'Generation evidence was recorded.';
  if(p.kind==='hold')return typeof p.reason==='string'&&Object.hasOwn(archiveReviewReasons,p.reason)?archiveReviewReasons[p.reason as keyof typeof archiveReviewReasons]:'The save was held for review.';
  return 'A saved-document observation was recorded.';
}
function preparationEvidence(row:Row,item:ArchiveReviewItem,manifest?:DocumentArchiveManifest){
  if(item.issued)return archivePreparationEvidence.parse({state:'issued'});
  if(!manifest)return archivePreparationEvidence.parse({state:'not_recorded'});
  let latestStorageEvidence=null;
  if(row.last_check){
    const payload=JSON.parse(row.last_check) as {kind?:unknown},status=checkStatus(payload,manifest);
    latestStorageEvidence={at:row.last_checked_at,outcome:payload.kind==='write_unknown'?'write_unconfirmed':status==='issued'?'matched':status};
  }
  return archivePreparationEvidence.parse({state:'prepared',expected:{format:manifest.format,template:manifest.template,size:manifest.size,sha256:manifest.sha256,
    requestedAt:manifest.requestedAt,sourceKind:manifest.source.kind,sourceFingerprint:manifest.source.fingerprint,sourceRecordCount:manifest.source.records.length},latestStorageEvidence});
}
/** Read-only projection of retained evidence. Never reads R2, retries a save or changes an observation. */
export class D1DocumentArchiveReview{
  constructor(private readonly db:D1Database){}
  private async boundary<T>(work:()=>Promise<T>){try{return await work();}catch(error){if(error instanceof DocumentArchiveError)throw error;archiveFail('storage_unavailable');}}
  async list(value:unknown,actorId:string){return this.boundary(async()=>{
    const parsed=archiveReviewQuery.safeParse(value);if(!parsed.success||!poId.safeParse(actorId).success)archiveFail('invalid_request');const q=parsed.data;
    const results=await this.db.batch<Row>([
      this.db.prepare(`SELECT user_id FROM memberships WHERE ${member}`).bind(q.companyId,actorId),
      this.db.prepare(`WITH candidates AS (SELECT ${projection} FROM document_archive_intents i WHERE ${scope}
        AND EXISTS(SELECT 1 FROM memberships WHERE ${member})) SELECT * FROM candidates WHERE ${attention} ORDER BY requested_at DESC,id DESC LIMIT 21 OFFSET ?`)
        .bind(q.companyId,q.kind,q.kind,q.orderId??'',q.companyId,actorId,q.offset),
    ]);
    if(!results[0].results.length)archiveFail('forbidden');
    return {viewerId:actorId,items:results[1].results.slice(0,20).map(row=>capture(row).item),hasMore:results[1].results.length>20};
  });}
  async detail(value:unknown,actorId:string){return this.boundary(async()=>{
    const parsed=archiveReviewDetailQuery.safeParse(value);if(!parsed.success||!poId.safeParse(actorId).success)archiveFail('invalid_request');const q=parsed.data;
    const args=[q.companyId,q.kind,q.kind,q.orderId??'',q.id,q.companyId,actorId];
    const results=await this.db.batch<Row|Event>([
      this.db.prepare(`SELECT user_id FROM memberships WHERE ${member}`).bind(q.companyId,actorId),
      this.db.prepare(`SELECT ${projection} FROM document_archive_intents i WHERE ${scope} AND i.id=? AND EXISTS(SELECT 1 FROM memberships WHERE ${member})`).bind(...args),
      this.db.prepare(`SELECT o.id,o.at,o.payload_json FROM document_archive_observations o JOIN document_archive_intents i ON i.company_id=o.company_id AND i.id=o.document_id
        WHERE ${scope} AND i.id=? AND EXISTS(SELECT 1 FROM memberships WHERE ${member})
        AND json_extract(o.payload_json,'$.check.contract') IS NOT 'pantrack.issued-file-check.v1' ORDER BY o.rowid DESC LIMIT 21 OFFSET ?`).bind(...args,q.offset),
    ]);
    if(!results[0].results.length)archiveFail('forbidden');const row=results[1].results[0] as Row|undefined;if(!row)archiveFail('missing');
    const {item,manifest}=capture(row),events=results[2].results as Event[];
    return {viewerId:actorId,item,canContinue:!row.artifact_json&&row.actor_id===actorId,preparation:preparationEvidence(row,item,manifest),events:events.slice(0,20).map(event=>({id:event.id,at:event.at,summary:eventSummary(event,manifest)})),hasMore:events.length>20};
  });}
}
