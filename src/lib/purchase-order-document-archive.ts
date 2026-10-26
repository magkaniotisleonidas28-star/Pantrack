import {z} from 'zod';
import {poId} from './purchase-order-contract';
import {frozenCopy,canonicalJson} from './supplier-simulation-contract';
import {historyExportFingerprint} from './purchase-order-history-export-contract';
import {captureArchiveSource,type CapturedArchiveSource} from './purchase-order-document-archive-sources';
import {DOCUMENT_ARCHIVE_MAX_BYTES,DOCUMENT_ARCHIVE_LEASE_MS,documentArchiveRequest,archiveFail,archiveTemplate,archiveObjectKey,
  captureArchiveArtifact,captureArchiveManifest,DocumentArchiveError,type DocumentArchiveErrorCode,type DocumentArchiveRequest,
  type DocumentArchiveManifest,type ArchiveClaim,type ArchiveObservation,type DocumentArchiveJournal,type PrivateDocumentObjects} from './purchase-order-document-archive-contract';

type Dependencies={identity:()=>Promise<string|null>;clock?:{now():Date};journal:DocumentArchiveJournal;objects:PrivateDocumentObjects;
  sources:{load(request:DocumentArchiveRequest,actorId:string):Promise<unknown>};
  render:(source:CapturedArchiveSource,format:DocumentArchiveRequest['format'],template:DocumentArchiveManifest['template'])=>Promise<Uint8Array>};
const normalized=(value:unknown)=>JSON.parse(JSON.stringify(value));
const equal=(a:unknown,b:unknown)=>canonicalJson(normalized(a))===canonicalJson(normalized(b));
export async function documentByteDigest(bytes:Uint8Array){
  const value=new Uint8Array(bytes);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
}
function errorCode(error:unknown,phase:string):DocumentArchiveErrorCode{
  if(error instanceof DocumentArchiveError)return error.code;
  if(phase==='source'){
    const code=(error as {code?:unknown})?.code;if(code==='forbidden')return 'forbidden';
    if(['conflict','changed','missing','empty','too_large','source_invalid','storage_failure'].includes(String(code)))return 'source_changed';
  }
  return phase==='render'?'generation_failed':'storage_unavailable';
}
/** Archive lifecycle only. It is intentionally not an HTTP route, production journal or R2 binding. */
export class PurchaseOrderDocumentArchive{
  constructor(private readonly dependencies:Dependencies){}
  private async boundary<T>(work:()=>Promise<T>):Promise<T>{
    try{return await work();}catch(error){if(error instanceof DocumentArchiveError)throw error;archiveFail('storage_unavailable');}
  }
  private async actor(){const id=await this.dependencies.identity();if(!id)archiveFail('forbidden');return id;}
  private async sameActor(actorId:string){if(await this.actor()!==actorId)archiveFail('forbidden');}
  private async objectObservation(manifest:DocumentArchiveManifest){
    const object=await this.dependencies.objects.read(await archiveObjectKey(manifest),DOCUMENT_ARCHIVE_MAX_BYTES);
    const bytes=object?.bytes instanceof Uint8Array&&object.bytes.byteLength<=DOCUMENT_ARCHIVE_MAX_BYTES?new Uint8Array(object.bytes):null;
    const observation:ArchiveObservation={kind:'object',present:!!object,reportedSize:object&&Number.isSafeInteger(object.size)?object.size:null,
      byteLength:object?.bytes instanceof Uint8Array?object.bytes.byteLength:null,sha256:bytes?await documentByteDigest(bytes):null};
    return {bytes,observation};
  }
  private verified(manifest:DocumentArchiveManifest,observed:Awaited<ReturnType<PurchaseOrderDocumentArchive['objectObservation']>>){
    const o=observed.observation;
    if(o.kind!=='object'||!o.present)archiveFail('held');
    if(!observed.bytes||o.reportedSize!==manifest.size||o.byteLength!==manifest.size||o.sha256!==manifest.sha256)archiveFail('integrity');
    return observed.bytes;
  }
  async save(value:unknown){return this.boundary(()=>this.saveCommand(value));}
  private async saveCommand(value:unknown){
    const parsed=documentArchiveRequest.safeParse(value);if(!parsed.success)archiveFail('invalid_request');
    const request=frozenCopy(parsed.data),actorId=await this.actor(),requestFingerprint=await historyExportFingerprint({request,actorId});
    const started=await this.dependencies.journal.begin({request,actorId,requestFingerprint,template:archiveTemplate(request.source.kind,request.format),
      requestedAt:(this.dependencies.clock?.now()??new Date()).toISOString(),leaseMs:DOCUMENT_ARCHIVE_LEASE_MS});
    if(started.kind==='busy')archiveFail('busy');
    if(started.kind==='ready'){
      const existing=captureArchiveArtifact(started.artifact);this.binding(request,existing,actorId);
      return (await this.read({companyId:request.companyId,id:existing.id})).artifact;
    }
    const claim=frozenCopy(started.claim);
    if(!equal(claim.request,request)||claim.actorId!==actorId||claim.requestFingerprint!==requestFingerprint||!z.string().uuid().safeParse(claim.id).success||
      !z.string().uuid().safeParse(claim.token).success||claim.template!==archiveTemplate(request.source.kind,request.format))archiveFail('integrity');
    let phase='source';
    try{
      let manifest=claim.manifest?captureArchiveManifest(claim.manifest):undefined;
      if(!manifest){
        const source=await captureArchiveSource(request,await this.dependencies.sources.load(request,actorId));
        phase='render';const output=await this.dependencies.render(source,request.format,claim.template);
        const size=output instanceof Uint8Array?output.byteLength:null;
        const bytes=output instanceof Uint8Array&&size!==null&&size<=DOCUMENT_ARCHIVE_MAX_BYTES?new Uint8Array(output):null;
        const magic=bytes?Array.from(bytes.subarray(0,8),b=>b.toString(16).padStart(2,'0')).join(''):null;
        const signature=!magic?'missing':magic.startsWith('255044462d')?'pdf':magic.startsWith('504b0304')?'xlsx':'other';
        phase='audit';await this.dependencies.journal.observe(claim,{kind:'generation',size,signature});phase='render';
        if(!bytes||size===0||signature!==request.format)archiveFail('generation_failed');
        manifest=captureArchiveManifest({contract:'pantrack.document-archive.v1',id:claim.id,companyId:request.companyId,actorId,format:request.format,
          template:claim.template,label:source.label,sha256:await documentByteDigest(bytes),size:bytes.byteLength,source:source.proof,requestedAt:claim.requestedAt,retention:'retain-until-explicit-policy'});
        phase='prepare';await this.sameActor(actorId);await this.dependencies.journal.prepare(claim,manifest);
        // The complete source/hash/size/key identity is durable before the first external write.
        phase='write';try{await this.dependencies.objects.putIfAbsent(await archiveObjectKey(manifest),new Uint8Array(bytes));}
        catch{await this.dependencies.journal.observe(claim,{kind:'write_unknown'});archiveFail('held');}
      }
      if(manifest.id!==claim.id||manifest.companyId!==request.companyId||manifest.actorId!==actorId||manifest.template!==claim.template||manifest.format!==request.format||manifest.requestedAt!==claim.requestedAt)archiveFail('integrity');
      this.binding(request,manifest,actorId);
      phase='verify';let observed:Awaited<ReturnType<PurchaseOrderDocumentArchive['objectObservation']>>;
      try{observed=await this.objectObservation(manifest);}catch{await this.dependencies.journal.observe(claim,{kind:'read_unknown'});archiveFail('storage_unavailable');}
      const observationId=await this.dependencies.journal.observe(claim,observed.observation);this.verified(manifest,observed);
      phase='publish';await this.sameActor(actorId);const artifact=captureArchiveArtifact(await this.dependencies.journal.publish(claim,observationId));
      const {issuedAt,...stored}=artifact;if(!equal(stored,manifest))archiveFail('integrity');return artifact;
    }catch(error){const code=errorCode(error,phase);try{await this.dependencies.journal.hold(claim,code);}catch{}throw new DocumentArchiveError(code);}
  }
  private binding(request:DocumentArchiveRequest,manifest:DocumentArchiveManifest,actorId:string){
    if(manifest.companyId!==request.companyId||manifest.actorId!==actorId||manifest.format!==request.format||manifest.source.kind!==request.source.kind||
      (request.source.kind==='draft'?(manifest.source.records.length!==1||manifest.source.records[0].id!==request.source.orderId||manifest.source.records[0].revision!==request.source.revision):manifest.source.fingerprint!==request.source.fingerprint))archiveFail('integrity');
  }
  async read(value:unknown){return this.boundary(()=>this.readCommand(value));}
  private async readCommand(value:unknown){
    const parsed=z.object({companyId:poId,id:z.string().uuid()}).strict().safeParse(value);if(!parsed.success)archiveFail('invalid_request');
    const {companyId,id}=parsed.data,actorId=await this.actor(),artifact=captureArchiveArtifact(await this.dependencies.journal.open(companyId,id,actorId));
    if(artifact.companyId!==companyId||artifact.id!==id)archiveFail('integrity');
    let observed:Awaited<ReturnType<PurchaseOrderDocumentArchive['objectObservation']>>;
    try{observed=await this.objectObservation(artifact);}catch{await this.dependencies.journal.observeRead(artifact,actorId,{kind:'read_unknown'});archiveFail('storage_unavailable');}
    await this.dependencies.journal.observeRead(artifact,actorId,observed.observation);
    await this.sameActor(actorId);await this.dependencies.journal.recheck(artifact,actorId);
    return {artifact,bytes:new Uint8Array(this.verified(artifact,observed))};
  }
}
