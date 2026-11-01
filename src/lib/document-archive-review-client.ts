import {archiveReviewPage,archiveReviewDetail,type ArchiveReviewSelection,type ArchiveReviewPage,type ArchiveReviewDetail} from './document-archive-review-contract';

export type ArchiveReviewState={loading:boolean;message:string;page:ArchiveReviewPage|null;detail:ArchiveReviewDetail|null;offset:number;eventOffset:number};
type Dependencies={fetch:typeof fetch};
/** One owned read at a time. Stale/aborted responses cannot restore private data after disposal or access loss. */
export class DocumentArchiveReviewClient{
  private live=true;private epoch=0;private abort:AbortController|null=null;private viewer:string;
  private state:ArchiveReviewState={loading:false,message:'',page:null,detail:null,offset:0,eventOffset:0};
  constructor(private readonly selection:ArchiveReviewSelection,viewerId:string,private readonly dependencies:Dependencies,private readonly changed:(state:ArchiveReviewState)=>void){this.viewer=viewerId;}
  private emit(){if(this.live)this.changed({...this.state});}
  private matches(item:ArchiveReviewDetail['item']){return item.companyId===this.selection.companyId&&item.source.kind===this.selection.kind&&(item.source.kind!=='draft'||item.source.orderId===this.selection.orderId);}
  private async load(kind:'page'|'detail',offset:number,id?:string){
    if(!this.live)return;this.abort?.abort();const abort=new AbortController(),epoch=++this.epoch;this.abort=abort;
    this.state={...this.state,loading:true,message:'',...(kind==='page'?{detail:null,eventOffset:0}:{})};this.emit();
    try{
      const params=new URLSearchParams({...this.selection,view:kind==='page'?'review':'review-detail',offset:String(offset),...(id?{id}:{})});
      const response=await this.dependencies.fetch('/api/purchase-order-documents?'+params,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:abort.signal});
      if(!this.live||epoch!==this.epoch){await response.body?.cancel().catch(()=>{});return;}
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('unavailable');}
      const raw=await response.json();if(!this.live||epoch!==this.epoch)return;
      const result=kind==='page'?archiveReviewPage.parse(raw):archiveReviewDetail.parse(raw);
      if(this.viewer&&result.viewerId!==this.viewer)throw Error('session');
      if('items' in result?result.items.some(item=>!this.matches(item)):!this.matches(result.item)||result.item.id!==id)throw Error('scope');
      this.viewer=result.viewerId;this.state={...this.state,loading:false,...('items' in result?{page:result,detail:null,offset}:{detail:result,eventOffset:offset})};this.emit();
    }catch{
      if(!this.live||epoch!==this.epoch)return;
      this.state={...this.state,loading:false,page:null,detail:null,message:'The review could not be read. Refresh or check your company access.'};this.emit();
    }finally{if(epoch===this.epoch)this.abort=null;}
  }
  list(offset=0){return this.load('page',offset);}
  detail(id:string,offset=0){return this.load('detail',offset,id);}
  cancel(){if(!this.live)return;this.epoch++;this.abort?.abort();this.abort=null;this.state={...this.state,loading:false,message:'Stopped loading. Refresh to see the latest recorded results.'};this.emit();}
  closeDetail(){if(!this.live)return;this.epoch++;this.abort?.abort();this.abort=null;this.state={...this.state,loading:false,detail:null,eventOffset:0,message:''};this.emit();}
  dispose(){this.live=false;this.epoch++;this.abort?.abort();this.abort=null;}
}
