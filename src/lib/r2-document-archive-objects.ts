import {DOCUMENT_ARCHIVE_MAX_BYTES,DocumentArchiveError,archiveFail,archiveMediaType,type PrivateDocumentObjects} from './purchase-order-document-archive-contract';
import {documentByteDigest} from './document-byte-digest';

const keyPattern=/^pantrack-documents\/v1\/([a-f0-9]{64})\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([a-f0-9]{64})\.(pdf|xlsx)$/;
function identity(key:string){
  const match=typeof key==='string'?keyPattern.exec(key):null;if(!match)archiveFail('invalid_request');
  return {sha256:match[3],format:match[4] as 'pdf'|'xlsx'};
}

/** Server-only object port. Company authorization and hash/size refusal auditing
 * belong to PurchaseOrderDocumentArchive and its D1 journal. There is no public
 * URL, list, deletion, overwrite, automatic retry or bucket provisioning API. */
export class R2DocumentArchiveObjects implements PrivateDocumentObjects{
  constructor(private readonly bucket:Pick<R2Bucket,'put'|'get'>){}
  private async boundary<T>(work:()=>Promise<T>):Promise<T>{
    try{return await work();}catch(error){if(error instanceof DocumentArchiveError)throw error;archiveFail('storage_unavailable');}
  }
  async putIfAbsent(key:string,value:Uint8Array):Promise<'created'|'exists'>{return this.boundary(async()=>{
    const expected=identity(key);
    if(!(value instanceof Uint8Array)||!value.byteLength||value.byteLength>DOCUMENT_ARCHIVE_MAX_BYTES)archiveFail('invalid_request');
    // Own the exact bytes before the first await, including a caller's subarray.
    const bytes=new Uint8Array(value);if(await documentByteDigest(bytes)!==expected.sha256)archiveFail('integrity');
    const checksum=Uint8Array.from(expected.sha256.match(/../g)!,part=>parseInt(part,16));
    const result=await this.bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},sha256:checksum,
      httpMetadata:{contentType:archiveMediaType(expected.format),cacheControl:'private, no-store',contentDisposition:'attachment'},
      customMetadata:{contract:'pantrack.document-archive.v1',sha256:expected.sha256}});
    if(result===null)return 'exists';
    if(!result||result.key!==key||result.size!==bytes.byteLength)archiveFail('storage_unavailable');
    return 'created';
  });}
  async read(key:string,maxBytes:number):Promise<{size:number;bytes:Uint8Array|null}|null>{return this.boundary(async()=>{
    identity(key);
    if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>DOCUMENT_ARCHIVE_MAX_BYTES)archiveFail('invalid_request');
    // One get binds the metadata and body to the same object version; no HEAD/GET race.
    const object=await this.bucket.get(key);if(object===null)return null;
    if(!object)archiveFail('storage_unavailable');const size=object.size,body=object.body;
    if(!body)archiveFail('storage_unavailable');
    if(object.key!==key){await body.cancel('archive-object-identity');archiveFail('storage_unavailable');}
    if(!Number.isSafeInteger(size)||size<0||size>maxBytes){
      await body.cancel('archive-size-limit');return {size,bytes:null};
    }
    const bytes=new Uint8Array(size),reader=body.getReader();let length=0;
    try{
      for(;;){
        const part=await reader.read();if(part.done)break;
        if(!(part.value instanceof Uint8Array)||part.value.byteLength>size-length){
          await reader.cancel('archive-body-limit');return {size,bytes:null};
        }
        bytes.set(part.value,length);length+=part.value.byteLength;
      }
      // Return actual short/corrupt bytes so the lifecycle durably observes their
      // size/hash before refusing them. A partial document is never handed off.
      return {size,bytes:length===size?bytes:bytes.slice(0,length)};
    }catch{
      try{await reader.cancel('archive-read-failed');}catch{/* The read still fails closed. */}
      archiveFail('storage_unavailable');
    }finally{reader.releaseLock();}
  });}
}
