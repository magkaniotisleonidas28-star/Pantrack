import {z} from 'zod';
import {poId} from './purchase-order-contract';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import {historyExportFingerprint} from './purchase-order-history-export-contract';
import {documentArchiveSourceGuard,observeDocumentArchiveSource,requireDocumentArchiveSource} from './d1-document-archive-source-guard';
import {documentArchiveRequest,captureArchiveManifest,captureArchiveArtifact,archiveTemplate,archiveFail,DocumentArchiveError,
  DOCUMENT_ARCHIVE_LEASE_MS,type DocumentArchiveJournal,type ArchiveClaim,type ArchiveObservation,type DocumentArchiveManifest,
  type DocumentArchiveArtifact,type DocumentArchiveErrorCode} from './purchase-order-document-archive-contract';

const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
const digest=z.string().regex(/^[a-f0-9]{64}$/),integer=z.number().int().safe();
const observationSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('generation'),size:integer.nonnegative().nullable(),signature:z.enum(['pdf','xlsx','other','missing'])}).strict(),
  z.object({kind:z.literal('object'),present:z.boolean(),reportedSize:integer.nullable(),byteLength:integer.nonnegative().nullable(),sha256:digest.nullable()}).strict(),
  z.object({kind:z.literal('write_unknown')}).strict(),z.object({kind:z.literal('read_unknown')}).strict(),
]);
type Row={company_id:string;id:string;operation_id:string;actor_id:string;fingerprint:string;request_json:string;template:DocumentArchiveManifest['template'];
  requested_at:string;state:string;token:string;lease_until:string|null;manifest_json:string|null;artifact_json:string|null;reason:string|null;write_id:string};
const normalized=(value:unknown)=>JSON.parse(JSON.stringify(value));
const same=(a:unknown,b:unknown)=>canonicalJson(normalized(a))===canonicalJson(normalized(b));
const parse=(text:string)=>JSON.parse(text) as unknown;

/** Server-only D1 journal. No object credentials, HTTP route or application wiring.
 * Each mutation checks its current role/lease/source in the actual SQL statement;
 * the following read shares its D1 batch transaction. meta.changes is never trusted. */
export class D1DocumentArchiveJournal implements DocumentArchiveJournal{
  constructor(private readonly db:D1Database,private readonly options:{clock?:{now():Date;sqlNow?:string}}={}){}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  // Production evaluates database time in the mutating statement. A trusted local
  // test clock may supply a SQL expression backed by its disposable clock table.
  private sqlNow(){return this.options.clock?.sqlNow??"strftime('%Y-%m-%dT%H:%M:%fZ','now')";}
  private async boundary<T>(work:()=>Promise<T>):Promise<T>{
    try{return await work();}catch(error){if(error instanceof DocumentArchiveError)throw error;archiveFail('storage_unavailable');}
  }
  private async row(companyId:string,id:string,actorId:string){
    if(!poId.safeParse(companyId).success||!poId.safeParse(actorId).success||!z.string().uuid().safeParse(id).success)archiveFail('invalid_request');
    const row=await this.db.prepare(`SELECT i.* FROM memberships m LEFT JOIN document_archive_intents i ON i.company_id=m.company_id AND i.id=?
      WHERE m.company_id=? AND m.user_id=? AND m.role IN ('owner','manager')`).bind(id,companyId,actorId).first<Row>();
    if(!row)archiveFail('forbidden');if(!row.id)archiveFail('missing');return row;
  }
  private claim(row:Row):ArchiveClaim{
    const request=documentArchiveRequest.parse(parse(row.request_json));
    if(request.companyId!==row.company_id||request.operationId!==row.operation_id)archiveFail('integrity');
    return frozenCopy({id:row.id,request,actorId:row.actor_id,requestFingerprint:row.fingerprint,template:row.template,
      requestedAt:row.requested_at,token:row.token,leaseUntil:row.lease_until!,...(row.manifest_json?{manifest:captureArchiveManifest(parse(row.manifest_json))}:{})});
  }
  private async owned(claim:ArchiveClaim,active=false){
    const row=await this.row(claim.request.companyId,claim.id,claim.actorId);
    if(row.actor_id!==claim.actorId||row.fingerprint!==claim.requestFingerprint||!same(parse(row.request_json),claim.request)||
      row.template!==claim.template||row.requested_at!==claim.requestedAt)archiveFail('fenced');
    if(active&&(row.artifact_json||row.token!==claim.token||!row.lease_until||row.lease_until<=this.now()))archiveFail('fenced');return row;
  }
  private binding(row:Row,manifest:DocumentArchiveManifest){
    const request=documentArchiveRequest.parse(parse(row.request_json)),source=request.source;
    if(manifest.id!==row.id||manifest.companyId!==row.company_id||manifest.actorId!==row.actor_id||manifest.template!==row.template||
      manifest.requestedAt!==row.requested_at||manifest.format!==request.format||manifest.source.kind!==source.kind||
      (source.kind==='draft'?(manifest.source.records.length!==1||manifest.source.records[0].id!==source.orderId||manifest.source.records[0].revision!==source.revision):
        manifest.source.fingerprint!==source.fingerprint))archiveFail('integrity');return request;
  }
  private async append(claim:ArchiveClaim,payload:unknown){
    const id=crypto.randomUUID();
    const write=this.db.prepare(`INSERT INTO document_archive_observations(company_id,document_id,id,actor_id,token,payload_json,at)
      SELECT i.company_id,i.id,?,i.actor_id,?,?,? FROM document_archive_intents i JOIN document_archive_leases l
        ON l.company_id=i.company_id AND l.document_id=i.id AND l.token=?
      WHERE i.company_id=? AND i.id=? AND i.actor_id=? AND i.fingerprint=? AND i.request_json=?`).bind(id,claim.token,JSON.stringify(payload),this.now(),
        claim.token,claim.request.companyId,claim.id,claim.actorId,claim.requestFingerprint,JSON.stringify(claim.request));
    const read=this.db.prepare('SELECT id FROM document_archive_observations WHERE company_id=? AND document_id=? AND id=? AND token=?')
      .bind(claim.request.companyId,claim.id,id,claim.token);
    try{const result=await this.db.batch([write,read]);if(!result[1].results.length)archiveFail('fenced');}
    catch(error){if(error instanceof DocumentArchiveError)throw error;
      if(!await read.first())archiveFail('storage_unavailable');}
    return id;
  }
  private async sourceCheck(claim:ArchiveClaim,manifest:DocumentArchiveManifest,phase:'prepare'|'publish',observationId?:string){
    const observed=await observeDocumentArchiveSource(this.db,claim.request,claim.actorId);
    await this.append(claim,{kind:'source_check',phase,expected:manifest,observed,...(observationId?{observationId}:{})});
    requireDocumentArchiveSource(manifest,observed);return documentArchiveSourceGuard(claim.request,manifest);
  }
  private async mutate(claim:ArchiveClaim,write:D1PreparedStatement,writeId:string,source=false){
    const read=this.db.prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND id=?') .bind(claim.request.companyId,claim.id);
    let result:Row|undefined;
    try{const results=await this.db.batch([write,read]);result=results[1].results[0] as Row|undefined;}
    catch{result=await read.first<Row>()??undefined;if(result?.write_id!==writeId){await this.owned(claim,true);archiveFail('storage_unavailable');}}
    if(result?.write_id!==writeId){await this.owned(claim,true);archiveFail(source?'source_changed':'fenced');}
    return result;
  }
  async begin(input:Parameters<DocumentArchiveJournal['begin']>[0]){return this.boundary(async()=>{
    const parsed=documentArchiveRequest.safeParse(input.request),actor=poId.safeParse(input.actorId);
    if(!parsed.success||!actor.success)archiveFail('invalid_request');const request=frozenCopy(parsed.data),actorId=actor.data,at=this.now();
    if(input.leaseMs!==DOCUMENT_ARCHIVE_LEASE_MS||input.template!==archiveTemplate(request.source.kind,request.format)||
      !z.string().datetime().safeParse(input.requestedAt).success||input.requestedAt>at||
      input.requestFingerprint!==await historyExportFingerprint({request,actorId}))archiveFail('invalid_request');
    const id=crypto.randomUUID(),token=crypto.randomUUID(),sqlNow=this.sqlNow();
    const write=this.db.prepare(`INSERT INTO document_archive_intents(company_id,id,operation_id,actor_id,fingerprint,request_json,template,requested_at,
      state,token,lease_until,write_id,updated_at) SELECT ?,?,?,?,?,?,?,${sqlNow},'reserved',?,
        strftime('%Y-%m-%dT%H:%M:%fZ',${sqlNow},'+3 minutes'),?,${sqlNow} WHERE ${MEMBER}
      ON CONFLICT(company_id,operation_id) DO UPDATE SET token=excluded.token,lease_until=excluded.lease_until,
        state= CASE WHEN document_archive_intents.manifest_json IS NULL THEN 'reserved' ELSE 'prepared' END ,reason=NULL,write_id=excluded.write_id,updated_at=excluded.updated_at
      WHERE document_archive_intents.actor_id=excluded.actor_id AND document_archive_intents.fingerprint=excluded.fingerprint
        AND document_archive_intents.request_json=excluded.request_json AND document_archive_intents.artifact_json IS NULL
        AND (document_archive_intents.lease_until IS NULL OR document_archive_intents.lease_until<=${sqlNow})`)
      .bind(request.companyId,id,request.operationId,actorId,input.requestFingerprint,JSON.stringify(request),input.template,token,token,request.companyId,actorId);
    const read=this.db.prepare(`SELECT i.* FROM memberships m LEFT JOIN document_archive_intents i ON i.company_id=m.company_id AND i.operation_id=?
      WHERE m.company_id=? AND m.user_id=? AND m.role IN ('owner','manager')`).bind(request.operationId,request.companyId,actorId);
    let row:Row|null;
    try{const result=await this.db.batch([write,read]);row=result[1].results[0] as Row??null;}catch{row=await read.first<Row>();}
    if(!row)archiveFail('forbidden');if(!row.id)archiveFail('storage_unavailable');
    if(row.actor_id!==actorId||row.fingerprint!==input.requestFingerprint||!same(parse(row.request_json),request))archiveFail('conflict');
    if(row.artifact_json)return {kind:'ready' as const,artifact:captureArchiveArtifact(parse(row.artifact_json))};
    if(row.token!==token)return {kind:'busy' as const};return {kind:'claim' as const,claim:this.claim(row)};
  });}
  async prepare(claim:ArchiveClaim,value:DocumentArchiveManifest){return this.boundary(async()=>{
    const row=await this.owned(claim,true),manifest=captureArchiveManifest(value);this.binding(row,manifest);
    const guard=await this.sourceCheck(claim,manifest,'prepare'),writeId=crypto.randomUUID(),sqlNow=this.sqlNow();
    const write=this.db.prepare(`UPDATE document_archive_intents SET manifest_json=?,state='prepared',write_id=?,updated_at=${sqlNow}
      WHERE company_id=? AND id=? AND token=? AND actor_id=? AND artifact_json IS NULL AND lease_until>${sqlNow}
      AND (manifest_json IS NULL OR manifest_json=?) AND ${MEMBER} AND (${guard.sql})`)
      .bind(JSON.stringify(manifest),writeId,row.company_id,row.id,claim.token,claim.actorId,JSON.stringify(manifest),row.company_id,claim.actorId,...guard.args);
    await this.mutate(claim,write,writeId,true);
  });}
  async observe(claim:ArchiveClaim,value:ArchiveObservation){return this.boundary(async()=>{
    const parsed=observationSchema.safeParse(value);if(!parsed.success)archiveFail('invalid_request');return this.append(claim,parsed.data);
  });}
  async publish(claim:ArchiveClaim,observationId:string){return this.boundary(async()=>{
    const row=await this.owned(claim,true);if(!row.manifest_json)archiveFail('integrity');const manifest=captureArchiveManifest(parse(row.manifest_json));this.binding(row,manifest);
    const guard=await this.sourceCheck(claim,manifest,'publish',observationId),sqlNow=this.sqlNow(),writeId=crypto.randomUUID();
    const evidence=await this.db.prepare('SELECT payload_json FROM document_archive_observations WHERE company_id=? AND document_id=? AND id=? AND token=?')
      .bind(row.company_id,row.id,observationId,claim.token).first<{payload_json:string}>();
    const observed=evidence?observationSchema.safeParse(parse(evidence.payload_json)):null;
    if(!observed?.success||observed.data.kind!=='object'||!observed.data.present||observed.data.sha256!==manifest.sha256||
      observed.data.reportedSize!==manifest.size||observed.data.byteLength!==manifest.size)archiveFail('integrity');
    const write=this.db.prepare(`UPDATE document_archive_intents SET artifact_json=json_set(manifest_json,'$.issuedAt',${sqlNow}),
      state='ready',lease_until=NULL,reason=NULL,write_id=?,updated_at=${sqlNow}
      WHERE company_id=? AND id=? AND token=? AND actor_id=? AND artifact_json IS NULL AND lease_until>${sqlNow} AND manifest_json=?
      AND ${MEMBER} AND (${guard.sql}) AND EXISTS (SELECT 1 FROM document_archive_observations o WHERE o.company_id=document_archive_intents.company_id
        AND o.document_id=document_archive_intents.id AND o.id=? AND o.token=? AND json_extract(o.payload_json,'$.kind')='object'
        AND json_extract(o.payload_json,'$.present')=1 AND json_extract(o.payload_json,'$.sha256')=?
        AND json_extract(o.payload_json,'$.reportedSize')=? AND json_extract(o.payload_json,'$.byteLength')=?)`)
      .bind(writeId,row.company_id,row.id,claim.token,claim.actorId,row.manifest_json,row.company_id,claim.actorId,...guard.args,
        observationId,claim.token,manifest.sha256,manifest.size,manifest.size);
    const saved=await this.mutate(claim,write,writeId,true);if(!saved.artifact_json)archiveFail('integrity');return captureArchiveArtifact(parse(saved.artifact_json));
  });}
  async hold(claim:ArchiveClaim,reason:DocumentArchiveErrorCode){return this.boundary(async()=>{
    // A revoked or expired known attempt may release only its own lease, retaining all evidence.
    await this.append(claim,{kind:'hold',reason});
    await this.db.prepare(`UPDATE document_archive_intents SET state='held',lease_until=NULL,reason=?,write_id=?,updated_at=${this.sqlNow()}
      WHERE company_id=? AND id=? AND actor_id=? AND token=? AND fingerprint=? AND artifact_json IS NULL`)
      .bind(reason,crypto.randomUUID(),claim.request.companyId,claim.id,claim.actorId,claim.token,claim.requestFingerprint).run();
  });}
  async open(companyId:string,id:string,actorId:string){return this.boundary(async()=>{
    const row=await this.row(companyId,id,actorId);if(!row.artifact_json)archiveFail('missing');return captureArchiveArtifact(parse(row.artifact_json));
  });}
  async observeRead(value:DocumentArchiveArtifact,actorId:string,observation:ArchiveObservation){return this.boundary(async()=>{
    const artifact=captureArchiveArtifact(value),parsed=observationSchema.safeParse(observation);if(!parsed.success||!poId.safeParse(actorId).success)archiveFail('invalid_request');
    const id=crypto.randomUUID(),write=this.db.prepare(`INSERT INTO document_archive_observations(company_id,document_id,id,actor_id,token,payload_json,at)
      SELECT company_id,id,?,?,NULL,?,? FROM document_archive_intents WHERE company_id=? AND id=? AND artifact_json=?`)
      .bind(id,actorId,JSON.stringify(parsed.data),this.now(),artifact.companyId,artifact.id,JSON.stringify(artifact));
    const read=this.db.prepare('SELECT id FROM document_archive_observations WHERE company_id=? AND document_id=? AND id=?').bind(artifact.companyId,artifact.id,id);
    try{const result=await this.db.batch([write,read]);if(!result[1].results.length)archiveFail('integrity');}catch(error){if(error instanceof DocumentArchiveError)throw error;if(!await read.first())archiveFail('storage_unavailable');}
  });}
  async recheck(value:DocumentArchiveArtifact,actorId:string){return this.boundary(async()=>{
    const artifact=captureArchiveArtifact(value),row=await this.row(artifact.companyId,artifact.id,actorId);
    if(row.artifact_json!==JSON.stringify(artifact))archiveFail('integrity');
  });}
}
