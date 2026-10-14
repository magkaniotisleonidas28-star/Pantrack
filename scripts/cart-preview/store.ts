import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PurchaseOrderView} from '../../src/lib/purchase-order-contract';
import {cartLines,type CartStart,type CartLine,type CartEntry,type CartJobView} from '../../src/lib/cart-preview-contract';

export type Job=CartJobView&{actor:string;companyId:string;operationId:string;request:string;cartKey:string;
  session:string;baseline:CartEntry[]|null;attempted:string[];verified:string[];input:CartLine[];events:Array<{state:Job['state'];message:string;at:string}>};
export type Fixture={token:string;entries:CartEntry[];loggedIn:boolean;lost:boolean;layout:CartStart['layout'];scenario:CartStart['scenario']};
type State={jobs:Job[];fixtures:Record<string,Fixture>;reservedMicros:number;calls:number};
export class CartStore{
  state:State;
  constructor(readonly path:string){mkdirSync(path,{recursive:true,mode:0o700});this.state=existsSync(path+'/state.json')?JSON.parse(readFileSync(path+'/state.json','utf8')):{jobs:[],fixtures:{},reservedMicros:0,calls:0};
    for(const job of this.state.jobs){job.events??=[];if(job.state==='preparing'){job.state='needs_review';job.message='Runner restarted. Resume to reconcile the existing cart.';job.events.push({state:job.state,message:job.message,at:new Date().toISOString()});}}this.save();}
  save(){const tmp=this.path+'/state.tmp';writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});renameSync(tmp,this.path+'/state.json');}
  create(body:CartStart,actor:string,order:PurchaseOrderView,mode:'offline'|'ai'='offline'){
    const request=JSON.stringify(body),old=this.state.jobs.find(j=>j.companyId===body.companyId&&j.operationId===body.operationId);
    if(old){if(old.actor!==actor||old.request!==request)throw Error('Operation ID already used for another request.');return old;}
    if(order.revision!==body.expectedRevision)throw Error('Draft changed. Open and review its latest revision.');
    const input=cartLines(order),cartKey=JSON.stringify([body.companyId,order.snapshot.supplier.id,order.snapshot.supplier.accountId,order.snapshot.supplier.locationId]);
    if(this.state.jobs.some(j=>j.cartKey===cartKey&&j.state!=='canceled'))throw Error('This cart already has a job. Resume or cancel it before preparing another.');
    const session=randomUUID(),now=new Date().toISOString();
    const job:Job={id:randomUUID(),orderId:order.snapshot.id,companyId:body.companyId,actor,operationId:body.operationId,request,revision:order.revision,cartKey,session,
      state:'preparing',mode,message:'Opening the fictional storefront…',lines:input.map(l=>({...l,verified:false})),startedAt:now,updatedAt:now,elapsedMs:0,interventions:0,layout:body.layout,scenario:body.scenario,input,baseline:null,attempted:[],verified:[],events:[{state:'preparing',message:'Created from reviewed draft.',at:now}]};
    // The cart belongs to the account, rather than the job. Canceled jobs never silently clear it.
    const previous=[...this.state.jobs].reverse().find(j=>j.cartKey===cartKey);
    const entries=previous?structuredClone(this.state.fixtures[previous.session].entries):[{sku:'EXISTING',unitLabel:'box',packs:'1',unitMinor:'350'}];
    this.state.fixtures[session]={token:randomUUID(),entries,loggedIn:body.scenario!=='login_expired',lost:false,layout:body.layout,scenario:body.scenario};
    this.state.jobs.push(job);this.save();return job;
  }
  get(id:string,actor:string,companyId:string){const j=this.state.jobs.find(j=>j.id===id&&j.actor===actor&&j.companyId===companyId);if(!j)throw Error('Cart job not found.');return j;}
  update(job:Job,state:Job['state'],message:string){job.state=state;job.message=message;job.updatedAt=new Date().toISOString();job.elapsedMs=Date.now()-Date.parse(job.startedAt);job.lines=job.input.map(l=>({...l,verified:job.verified.includes(l.sku)}));job.events.push({state,message,at:job.updatedAt});this.save();}
  current(job:Job,order:PurchaseOrderView){if(job.state==='canceled')return false;if(order.snapshot.id!==job.orderId||order.snapshot.companyId!==job.companyId||order.revision!==job.revision||order.status!=='reviewed'){
    const message='Draft changed or was canceled. Review the latest draft and cancel this cart job.';
    if(job.state!=='needs_review'||job.message!==message)this.update(job,'needs_review',message);return false;}return true;}
  view(job:Job):CartJobView{const {id,orderId,revision,state,mode,message,lines,startedAt,updatedAt,elapsedMs,interventions,layout,scenario}=job;return {id,orderId,revision,state,mode,message,lines,startedAt,updatedAt,elapsedMs,interventions,layout,scenario};}
}
