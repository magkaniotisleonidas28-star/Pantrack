import {capturePurchaseOrderExport,purchaseOrderExportRequest,type PurchaseOrderExportRequest,type PurchaseOrderExportSnapshot} from './purchase-order-export-contract';

export type PurchaseOrderDocumentFormat='pdf'|'xlsx';
export type PurchaseOrderDownloadState={phase:'idle'|'loading'|'success'|'error'|'held';message:string;format?:PurchaseOrderDocumentFormat;reload?:boolean};
export type PurchaseOrderDownloadDependencies<Snapshot=PurchaseOrderExportSnapshot>={
  fetch:(url:string,options:RequestInit)=>Promise<Response>;
  generate:(format:PurchaseOrderDocumentFormat,snapshot:Snapshot,signal:AbortSignal)=>Promise<Uint8Array>;
  download:(bytes:Uint8Array,filename:string,mime:string)=>void;
};
const idle:PurchaseOrderDownloadState={phase:'idle',message:''};
export class DownloadRefusal extends Error{constructor(message:string,readonly held=false,readonly reload=false){super(message);}}
export type PurchaseOrderDownloadFlow<Input,Snapshot>={
  loading:string;changed:string;
  read:(input:Input,fetch:PurchaseOrderDownloadDependencies<Snapshot>['fetch'],signal:AbortSignal,previous?:Snapshot)=>Promise<Snapshot>;
  filename:(snapshot:Snapshot,format:PurchaseOrderDocumentFormat)=>string;success:(snapshot:Snapshot,format:PurchaseOrderDocumentFormat)=>string;
};
const singleFlow:PurchaseOrderDownloadFlow<PurchaseOrderExportRequest,PurchaseOrderExportSnapshot>={
  loading:'from the saved revision',changed:'The saved details changed. Reload the draft before downloading.',
  read:async(input,fetch,signal)=>{
    const selection=purchaseOrderExportRequest.parse(input);
    const url='/api/purchase-order-exports?'+new URLSearchParams({companyId:selection.companyId,orderId:selection.orderId,revision:String(selection.revision)});
    const response=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});
    if(!response.ok){
      if(response.status===401)throw new DownloadRefusal('Your session expired. Sign in again before downloading.',true);
      if(response.status===403)throw new DownloadRefusal('Owner or manager access to this company is required.',true);
      if(response.status===409)throw new DownloadRefusal('The draft changed or was canceled. Reload the saved draft before downloading.',true,true);
      if(response.status===404)throw new DownloadRefusal('This saved draft is unavailable. Reload it before downloading.',true,true);
      throw new DownloadRefusal('The saved draft could not be checked. Try again or reload it.',false,true);
    }
    const body:unknown=await response.json();let snapshot:PurchaseOrderExportSnapshot;
    try{snapshot=capturePurchaseOrderExport((body as {export?:unknown})?.export);}
    catch{throw new DownloadRefusal('The saved details cannot be exported. Reload the draft and review them.',true,true);}
    if(snapshot.draft.companyId!==selection.companyId||snapshot.draft.id!==selection.orderId||snapshot.revision!==selection.revision){
      throw new DownloadRefusal('The returned draft does not match this selection. Reload the saved draft.',true,true);
    }
    return snapshot;
  },
  filename:(snapshot,format)=>{const number=snapshot.draft.number.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,100)||'draft';return `pantrack-${number}-r${snapshot.revision}-draft.${format}`;},
  success:(snapshot,format)=>`${format==='pdf'?'PDF':'Excel'} download started for saved revision ${snapshot.revision}. No order was placed.`,
};

/** Owns one download lifecycle. Cancellation invalidates every pending continuation. */
export class CheckedPurchaseOrderDownloader<Input,Snapshot>{
  private pending:AbortController|null=null;
  private disposed=false;
  constructor(private readonly dependencies:PurchaseOrderDownloadDependencies<Snapshot>,private readonly publish:(state:PurchaseOrderDownloadState)=>void,
    private readonly flow:PurchaseOrderDownloadFlow<Input,Snapshot>){}
  cancel():void{this.pending?.abort();this.pending=null;if(!this.disposed)this.publish(idle);}
  dispose():void{this.disposed=true;this.cancel();}
  async start(input:Input,format:PurchaseOrderDocumentFormat):Promise<void>{
    if(this.pending||this.disposed)return;
    const abort=new AbortController();this.pending=abort;
    const current=()=>!this.disposed&&this.pending===abort&&!abort.signal.aborted;
    let stage:'check'|'generate'|'download'='check';
    this.publish({phase:'loading',format,message:`Preparing ${format==='pdf'?'PDF':'Excel'} ${this.flow.loading}…`});
    try{
      const snapshot=await this.flow.read(input,this.dependencies.fetch,abort.signal);if(!current())return;
      stage='generate';const bytes=await this.dependencies.generate(format,snapshot,abort.signal);if(!current())return;
      // A slow library/font load must not bypass a later revocation, edit or cancellation.
      stage='check';const verified=await this.flow.read(input,this.dependencies.fetch,abort.signal,snapshot);if(!current())return;
      if(JSON.stringify(verified)!==JSON.stringify(snapshot))throw new DownloadRefusal(this.flow.changed,true,true);
      stage='download';
      this.dependencies.download(bytes,this.flow.filename(snapshot,format),
        format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if(current())this.publish({phase:'success',format,message:this.flow.success(snapshot,format)});
    }catch(error){
      if(!current())return;
      let message=error instanceof DownloadRefusal?error.message:stage==='download'?'The file could not be downloaded. Try again.':
        stage==='check'?'The saved draft could not be checked. Check your connection and try again.':`The ${format==='pdf'?'PDF':'Excel'} file could not be created or loaded. Try again.`;
      if(stage==='generate'&&error instanceof Error){
        if(/import|module/i.test(error.message))message='The download tools could not load. Reload this page, then try again.';
        else if(error.message.includes('font cannot display'))message='Some text cannot be displayed in PDF. Try Excel or edit the draft.';
        else if(error.message.includes('Excel cell limit'))message='An entry is too long for Excel. Try PDF or shorten the draft notes.';
        else if(/escape marker|invalid Unicode/.test(error.message))message='Some text cannot be exported to Excel. Review the draft or try PDF.';
      }
      this.publish({phase:error instanceof DownloadRefusal&&error.held?'held':'error',format,message,reload:error instanceof DownloadRefusal&&error.reload});
    }finally{if(this.pending===abort)this.pending=null;}
  }
}
export class PurchaseOrderDownloader extends CheckedPurchaseOrderDownloader<PurchaseOrderExportRequest,PurchaseOrderExportSnapshot>{
  constructor(dependencies:PurchaseOrderDownloadDependencies,publish:(state:PurchaseOrderDownloadState)=>void){super(dependencies,publish,singleFlow);}
}

export const browserPurchaseOrderDownloads:PurchaseOrderDownloadDependencies={
  fetch:(url,options)=>fetch(url,options),
  generate:async(format,snapshot,signal)=>{
    const documents=await import('./purchase-order-documents');
    if(signal.aborted)throw new DOMException('Canceled','AbortError');
    if(format==='xlsx')return documents.serializePurchaseOrderXlsx(snapshot);
    const response=await fetch('/fonts/NotoSans-Regular.ttf',{credentials:'same-origin',cache:'force-cache',redirect:'error',signal});
    if(!response.ok)throw new Error('PDF font unavailable.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length===0||bytes.length>2_000_000)throw new Error('PDF font unavailable.');
    return documents.serializePurchaseOrderPdf(snapshot,bytes);
  },
  download:(bytes,filename,mime)=>{
    const blob=new Blob([new Uint8Array(bytes)],{type:mime}),url=URL.createObjectURL(blob);
    let link:HTMLAnchorElement|null=null;
    try{link=document.createElement('a');link.href=url;link.download=filename;link.hidden=true;document.body.appendChild(link);link.click();}
    finally{try{link?.remove();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}}
  },
};
