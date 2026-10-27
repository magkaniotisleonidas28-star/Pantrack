import {documentArchiveRequest,captureArchiveArtifact,archiveMediaType,type DocumentArchiveRequest,type DocumentArchiveArtifact} from './purchase-order-document-archive-contract';
import {archiveFilename} from './purchase-order-archive-app-contract';
import {documentByteDigest} from './document-byte-digest';
import {purchaseOrderHistoryDownloadFlow} from './purchase-order-history-download';
import {DownloadRefusal} from './purchase-order-download';
import type {PurchaseOrderHistoryFilters} from './purchase-order-history-contract';

export type ArchiveSelection={companyId:string;source:{kind:'draft';orderId:string;revision:number}|{kind:'history';filters:PurchaseOrderHistoryFilters}};
export type ArchiveClientState={phase:'idle'|'working'|'success'|'error'|'held';message:string;pending:boolean;retryable?:boolean;reload?:boolean};
type Dependencies={fetch:typeof fetch;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;uuid:()=>string;
  download:(bytes:Uint8Array,filename:string,mime:string)=>void;saved:()=>void};
class Refusal extends Error{constructor(readonly code:string){super(code);}}
async function json(response:Response){
  if(response.ok){const value=await response.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Refusal('integrity');return value as Record<string,unknown>;}let code='storage_unavailable';
  try{const value=await response.json() as {code?:unknown}|null;if(typeof value?.code==='string')code=value.code;}catch{}
  if(response.status===401||response.status===403)code='forbidden';throw new Refusal(code);
}
/** Consume and release the real response stream, bounded by immutable metadata. */
export async function readSavedDocument(response:Response,artifact:DocumentArchiveArtifact){
  if(response.headers.get('content-type')!==archiveMediaType(artifact.format)||response.headers.get('x-pantrack-document-size')!==String(artifact.size)||
    response.headers.get('x-pantrack-document-id')!==artifact.id||response.headers.get('x-pantrack-document-sha256')!==artifact.sha256||!response.body){
    await response.body?.cancel();throw new Refusal('integrity');
  }
  const reader=response.body.getReader(),bytes=new Uint8Array(artifact.size);let length=0;
  try{
    for(;;){const part=await reader.read();if(part.done)break;
      if(!(part.value instanceof Uint8Array)||part.value.length>bytes.length-length)throw new Refusal('integrity');bytes.set(part.value,length);length+=part.value.length;}
    if(length!==artifact.size||await documentByteDigest(bytes)!==artifact.sha256)throw new Refusal('integrity');return bytes;
  }catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
}
export class PurchaseOrderArchiveClient{
  private active:AbortController|null=null;
  private disposed=false;
  private request:DocumentArchiveRequest|null=null;
  private recoveryBlocked=false;
  readonly storageKey:string;
  constructor(private readonly selection:ArchiveSelection,private readonly viewerId:string,private readonly dependencies:Dependencies,
    private readonly publish:(state:ArchiveClientState)=>void){
    this.storageKey=`pantrack.saved-copy.v1:${JSON.stringify([viewerId,selection.companyId,selection.source.kind,selection.source.kind==='draft'?selection.source.orderId:'history'])}`;
    try{
      const stored=dependencies.storage.getItem(this.storageKey);
      if(stored){const request=documentArchiveRequest.parse(JSON.parse(stored));this.checkScope(request);this.request=request;}
      this.state('idle',this.request?'An earlier save needs verification. Retry that save to check its result.':'');
    }catch{this.recoveryBlocked=true;this.state('held','Saved-copy recovery information is unavailable. Ask an owner to review before saving another copy.');}
  }
  private checkScope(request:DocumentArchiveRequest){
    if(request.companyId!==this.selection.companyId||request.source.kind!==this.selection.source.kind||
      request.source.kind==='draft'&&this.selection.source.kind==='draft'&&request.source.orderId!==this.selection.source.orderId)throw new Refusal('integrity');
  }
  private state(phase:ArchiveClientState['phase'],message:string,reload=false){if(!this.disposed)this.publish({phase,message,pending:!!this.request||this.recoveryBlocked,retryable:!!this.request&&!this.recoveryBlocked,reload});}
  cancel(){this.active?.abort();this.active=null;if(this.recoveryBlocked){this.state('held','Saved-copy recovery information is unavailable. Ask an owner to review before saving another copy.');return;}this.state('idle',this.request?'Stopped waiting. The save may still complete. Retry this save to check its result.':'');}
  dispose(){this.disposed=true;this.cancel();}
  private async run(work:(signal:AbortSignal,current:()=>boolean)=>Promise<void>){
    if(this.active||this.disposed||this.recoveryBlocked)return;const abort=new AbortController();this.active=abort;
    const current=()=>!this.disposed&&this.active===abort&&!abort.signal.aborted;this.state('working','Checking the saved copy…');
    try{await work(abort.signal,current);}catch(error){
      if(!current())return;
      if(error instanceof DownloadRefusal&&!this.request){this.state(error.held?'held':'error',error.message,error.reload);return;}
      const code=error instanceof Refusal?error.code:'storage_unavailable';
      if(code==='source_changed'&&this.request){try{this.dependencies.storage.removeItem(this.storageKey);this.request=null;}catch{this.recoveryBlocked=true;}}
      const messages:Record<string,string>={forbidden:'Your session or company access changed. Sign in with owner or manager access before continuing.',
        integrity:'The saved file could not be verified. It is held for review.',held:'The save needs review. Retry this save to verify its outcome.',
        busy:'This save is still in progress. Retry this save to check it.',source_changed:'The saved source changed. Reload it before saving another copy.',
        conflict:'This save could not be matched to its original request. Ask an owner to review.',missing:'This saved copy is unavailable. Refresh the saved copies.'};
      this.state(['forbidden','integrity','held','source_changed','conflict','missing'].includes(code)?'held':'error',
        Object.hasOwn(messages,code)?messages[code]:(this.request?'The save could not be confirmed. Retry this same save.':'The saved copy could not be checked. Try again.'),code==='source_changed');
    }finally{if(this.active===abort)this.active=null;}
  }
  async save(format:'pdf'|'xlsx'){if(this.request)return;return this.run(async(signal,current)=>{
    let source:DocumentArchiveRequest['source'];
    if(this.selection.source.kind==='draft')source=this.selection.source;
    else{
      const snapshot=await purchaseOrderHistoryDownloadFlow.read({companyId:this.selection.companyId,filters:this.selection.source.filters},this.dependencies.fetch,signal);
      if(!current())return;source={kind:'history',filters:snapshot.filters,fingerprint:snapshot.fingerprint};
    }
    const request=documentArchiveRequest.parse({companyId:this.selection.companyId,operationId:this.dependencies.uuid(),format,source});
    // Persist before dispatch. A reload/stop-waiting can only replay this exact request.
    this.dependencies.storage.setItem(this.storageKey,JSON.stringify(request));this.request=request;
    await this.submit(signal,current);
  });}
  async retry(){if(!this.request)return;return this.run((signal,current)=>this.submit(signal,current));}
  private async submit(signal:AbortSignal,current:()=>boolean){
    const request=this.request!;const body=await json(await this.dependencies.fetch('/api/purchase-order-documents',{method:'POST',credentials:'same-origin',
      cache:'no-store',redirect:'error',headers:{'content-type':'application/json','X-Pantrack-Archive-Viewer':this.viewerId},body:JSON.stringify(request),signal}));
    if(!current())return;const artifact=captureArchiveArtifact(body?.artifact);
    if(artifact.companyId!==request.companyId||artifact.actorId!==this.viewerId||artifact.format!==request.format||artifact.source.kind!==request.source.kind||
      (request.source.kind==='draft'?(artifact.source.records[0].id!==request.source.orderId||artifact.source.records[0].revision!==request.source.revision):artifact.source.fingerprint!==request.source.fingerprint))throw new Refusal('integrity');
    this.dependencies.storage.removeItem(this.storageKey);this.request=null;this.state('success','Permanent copy saved. You can download it from Saved copies.');this.dependencies.saved();
  }
  async download(value:DocumentArchiveArtifact){return this.run(async(signal,current)=>{
    const artifact=captureArchiveArtifact(value);if(artifact.companyId!==this.selection.companyId)throw new Refusal('integrity');
    if(artifact.source.kind!==this.selection.source.kind||artifact.source.kind==='draft'&&this.selection.source.kind==='draft'&&artifact.source.records[0].id!==this.selection.source.orderId)throw new Refusal('integrity');
    const params=new URLSearchParams({companyId:artifact.companyId,id:artifact.id}),url='/api/purchase-order-documents?'+params;
    const options={method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal} as const;
    const response=await this.dependencies.fetch(url,options);if(!current()){await response.body?.cancel();return;}
    if(!response.ok)await json(response);const bytes=await readSavedDocument(response,artifact);if(!current())return;
    // Slow transfer/hash work cannot bypass later revocation or a changed session.
    const checked=await json(await this.dependencies.fetch(url+'&view=metadata',options));if(!current())return;
    if(checked?.viewerId!==this.viewerId||JSON.stringify(captureArchiveArtifact(checked?.artifact))!==JSON.stringify(artifact))throw new Refusal('forbidden');
    this.dependencies.download(bytes,archiveFilename(artifact),archiveMediaType(artifact.format));this.state('success','Saved copy download started.');
  });}
}
