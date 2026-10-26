import {z} from 'zod';
import {poId} from './purchase-order-contract';
import {purchaseOrderHistoryFilters} from './purchase-order-history-contract';
import {PURCHASE_ORDER_EXPORT_LABEL} from './purchase-order-export-contract';
import {HISTORY_EXPORT_LABEL,historyExportFingerprint} from './purchase-order-history-export-contract';
import {frozenCopy} from './supplier-simulation-contract';

export const DOCUMENT_ARCHIVE_MAX_BYTES=10*1024*1024,DOCUMENT_ARCHIVE_LEASE_MS=180_000;
export const DOCUMENT_ARCHIVE_TEMPLATES=['pantrack.saved-draft.pdf.v1','pantrack.saved-draft.xlsx.v1',
  'pantrack.draft-history.pdf.v1','pantrack.draft-history.xlsx.v1'] as const;
const digest=z.string().regex(/^[a-f0-9]{64}$/),version=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const documentArchiveRequest=z.object({companyId:poId,operationId:poId,format:z.enum(['pdf','xlsx']),source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('draft'),orderId:poId,revision:version}).strict(),
  z.object({kind:z.literal('history'),filters:purchaseOrderHistoryFilters.default({}),fingerprint:digest}).strict(),
])}).strict();
export type DocumentArchiveRequest=z.infer<typeof documentArchiveRequest>;
const proof=z.object({kind:z.enum(['draft','history']),fingerprint:digest,records:z.array(z.object({id:poId,revision:version,
  status:z.enum(['draft','reviewed','canceled'])}).strict()).min(1).max(100)}).strict();
const manifestSchema=z.object({contract:z.literal('pantrack.document-archive.v1'),id:z.string().uuid(),companyId:poId,actorId:poId,
  format:z.enum(['pdf','xlsx']),template:z.enum(DOCUMENT_ARCHIVE_TEMPLATES),label:z.enum([PURCHASE_ORDER_EXPORT_LABEL,HISTORY_EXPORT_LABEL]),
  sha256:digest,size:z.number().int().positive().max(DOCUMENT_ARCHIVE_MAX_BYTES),source:proof,requestedAt:z.string().datetime(),
  retention:z.literal('retain-until-explicit-policy')}).strict();
export type DocumentArchiveManifest=z.infer<typeof manifestSchema>;
export type DocumentArchiveArtifact=DocumentArchiveManifest&{issuedAt:string};
export const documentArchiveMessages={invalid_request:'Choose a company, saved source, format and stable operation ID.',
  forbidden:'Current owner or manager access is required.',missing:'This archived document is unavailable.',
  conflict:'This operation ID belongs to a different request or actor.',busy:'This save is already in progress.',
  source_changed:'The saved source changed or is no longer exportable. Refresh it before saving.',
  generation_failed:'The document could not be generated safely.',held:'The save needs review. Retry the same request to verify its outcome.',
  integrity:'The stored file does not match its immutable record. It is held for review.',
  fenced:'This save attempt no longer owns the operation.',storage_unavailable:'Document storage is unavailable. Retry the same request.'} as const;
export type DocumentArchiveErrorCode=keyof typeof documentArchiveMessages;
export class DocumentArchiveError extends Error{constructor(readonly code:DocumentArchiveErrorCode){super(documentArchiveMessages[code]);}}
export function archiveFail(code:DocumentArchiveErrorCode):never{throw new DocumentArchiveError(code);}
export function archiveTemplate(kind:'draft'|'history',format:'pdf'|'xlsx'){
  return DOCUMENT_ARCHIVE_TEMPLATES[(kind==='draft'?0:2)+(format==='pdf'?0:1)];
}
function validateManifest(value:DocumentArchiveManifest){
  if(value.template!==archiveTemplate(value.source.kind,value.format)||value.label!==(value.source.kind==='draft'?PURCHASE_ORDER_EXPORT_LABEL:HISTORY_EXPORT_LABEL)||
    new Set(value.source.records.map(r=>r.id)).size!==value.source.records.length||
    value.source.kind==='draft'&&(value.source.records.length!==1||value.source.records[0].status==='canceled'))archiveFail('integrity');
  return frozenCopy(value);
}
export function captureArchiveManifest(value:unknown):DocumentArchiveManifest{
  const parsed=manifestSchema.safeParse(value);if(!parsed.success)archiveFail('integrity');return validateManifest(parsed.data);
}
export function captureArchiveArtifact(value:unknown):DocumentArchiveArtifact{
  const parsed=manifestSchema.extend({issuedAt:z.string().datetime()}).safeParse(value);if(!parsed.success)archiveFail('integrity');
  const {issuedAt,...manifest}=parsed.data;if(Date.parse(issuedAt)<Date.parse(manifest.requestedAt))archiveFail('integrity');
  return frozenCopy({...validateManifest(manifest),issuedAt});
}
export const archiveMediaType=(format:'pdf'|'xlsx')=>format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Opaque company prefix; no user text, storage URL or provider key is accepted in the command. */
export async function archiveObjectKey(manifest:DocumentArchiveManifest|DocumentArchiveArtifact){
  const safe='issuedAt' in manifest?captureArchiveArtifact(manifest):captureArchiveManifest(manifest);
  const company=await historyExportFingerprint({companyId:safe.companyId});
  return `pantrack-documents/v1/${company}/${safe.id}/${safe.sha256}.${safe.format}`;
}
export type ArchiveObservation={kind:'generation';size:number|null;signature:'pdf'|'xlsx'|'other'|'missing'}|
  {kind:'object';present:boolean;reportedSize:number|null;byteLength:number|null;sha256:string|null}|
  {kind:'write_unknown'|'read_unknown'};
export type ArchiveClaim={id:string;request:DocumentArchiveRequest;actorId:string;requestFingerprint:string;template:DocumentArchiveManifest['template'];
  requestedAt:string;token:string;leaseUntil:string;manifest?:DocumentArchiveManifest};
export type ArchiveBegin={kind:'ready';artifact:DocumentArchiveArtifact}|{kind:'busy'}|{kind:'claim';claim:ArchiveClaim};

/** Server-only port. A production adapter must pass the conformance tests before it is connected.
 * begin/open/recheck authorize the current company owner/manager inside the metadata transaction.
 * prepare/publish additionally compare the complete current source (including filtered membership)
 * atomically with the transition. Every transition is fenced by token/expiry. Issued data is immutable.
 * Observations append durably before decisions; expired attempts may append audit evidence only.
 * hold preserves a prepared manifest, releases ownership, and never publishes or deletes an object. */
export interface DocumentArchiveJournal{
  begin(input:{request:DocumentArchiveRequest;actorId:string;requestFingerprint:string;template:DocumentArchiveManifest['template'];requestedAt:string;leaseMs:number}):Promise<ArchiveBegin>;
  prepare(claim:ArchiveClaim,manifest:DocumentArchiveManifest):Promise<void>;
  observe(claim:ArchiveClaim,observation:ArchiveObservation):Promise<string>;
  publish(claim:ArchiveClaim,observationId:string):Promise<DocumentArchiveArtifact>;
  hold(claim:ArchiveClaim,reason:DocumentArchiveErrorCode):Promise<void>;
  open(companyId:string,id:string,actorId:string):Promise<DocumentArchiveArtifact>;
  observeRead(artifact:DocumentArchiveArtifact,actorId:string,observation:ArchiveObservation):Promise<void>;
  recheck(artifact:DocumentArchiveArtifact,actorId:string):Promise<void>;
}
/** Atomic create-only storage: never overwrite, delete, list publicly or return signed/public URLs.
 * read reports oversized objects without loading their body; returned bodies belong to the caller. */
export interface PrivateDocumentObjects{
  putIfAbsent(key:string,bytes:Uint8Array):Promise<'created'|'exists'>;
  read(key:string,maxBytes:number):Promise<{size:number;bytes:Uint8Array|null}|null>;
}
