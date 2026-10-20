import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {FakeCartWorker} from './client.mjs';
import {readPrivate,profileLock} from './private-files.mjs';
import {assertGateSource,registerGateProfile} from './full-gate-runtime.mjs';
import {openLocalCartBrowser,closeLocalCartBrowser,readCart} from '../cart-preview/browser-session';
/** No browser write operation exists here. Login is clicked by the manager in the visible window. */
export class HumanBrowserWorker extends FakeCartWorker {
 queryKey='sessionId';stopping=false;fixtureFile:string;headless:boolean;activeSession:Awaited<ReturnType<typeof openLocalCartBrowser>>|undefined;
 constructor(options:any){super(options);this.url=this.url.replace('/po-cart-worker','/po-cart-browser-session');this.queryKey='sessionId';this.fixtureFile=options.fixtureFile;this.headless=options.headless??false;}
 requestStop(){this.stopping=true;}
 mutate(action:string|null,fields:any={},resume=false):Promise<any>{return this.serialized(async()=>{
  if(!resume){if(this.state.pending)throw Error('Pending operation requires recovery.');this.state.pending={action,...fields,operationId:randomUUID()};this.save();}
  const body=this.state.pending;if(!body)throw Error('No pending operation.');
  const {data}=await this.http('POST',body);
  if(data.receipt?.operationId!==body.operationId||data.receipt?.sessionId!==body.sessionId||data.receipt?.action!==body.action||data.current?.session.id!==body.sessionId)throw Error('Invalid session acknowledgment.');
  if(body.action==='claim'&&data.current.session.state==='opening')this.state.human={sessionId:body.sessionId,fence:data.current.session.fence,phase:'claimed'};
  this.state.pending=null;this.save();return data;
 });}
 async stopDurably(sessionId:string,fence:number,reason:string){
  if(this.state.pending)return;
  try{await this.mutate('fail',{sessionId,fence,reason});}catch(e){if([404,409].includes((e as any).status)){this.state.pending=null;this.save();}if(this.state.pending)return;try{await this.mutate('expire',{sessionId});}catch{/* Expired/revoked ownership remains unresolved and never grants resume. */}}
 }
 async tick(){
  if(this.state.pending){try{await this.mutate(null,{},true);}catch(e){if(![404,409].includes((e as any).status))throw e;this.state.pending=null;this.save();}}
  const prior=this.state.human;
  if(prior){
   const current=(await this.http('GET',null,prior.sessionId)).data.current;
   if(['closed','failed','expired'].includes(current.session.state)){this.state.human=null;this.save();}
   else if(prior.phase==='closed'&&current.session.state==='closing'){await this.mutate('complete',{sessionId:prior.sessionId,fence:prior.fence,cart:prior.cart});this.state.human=null;this.save();return;}
   else if(prior.phase!=='claimed'){
    // An opening/open marker survives crashes. Never reopen or adopt an orphaned browser.
    await this.stopDurably(prior.sessionId,prior.fence,'connection_lost');return;
   }
  }
  let current=this.state.human?(await this.http('GET',null,this.state.human.sessionId)).data.current:(await this.http('GET')).data.current;
  if(!current)return;
  const sessionId=current.session.id;
  if(!current.session.allowed){
   if(current.session.state==='closing'&&!current.session.workerId){await this.mutate('claim',{sessionId});return;}
   await this.mutate('expire',{sessionId});return;
  }
  if(current.session.state==='requested')current=(await this.mutate('claim',{sessionId})).current;
  const marker=this.state.human,fence=current.session.fence;
  if(!marker||marker.sessionId!==sessionId||marker.phase!=='claimed'||current.session.workerId!==this.state.workerId||current.session.state!=='opening')return;
  let session:Awaited<ReturnType<typeof openLocalCartBrowser>>|undefined,unlock:(()=>void)|undefined,finished=false,timedOut=false;
  const accessAllowed=()=>!this.stopping&&!timedOut&&Date.now()<Math.min(Date.parse(current.session.leaseUntil),Date.parse(current.session.expiresAt));
  const watchdog=setInterval(()=>{if(!accessAllowed()){timedOut=true;void session?.browser.close().catch(()=>{});}},250);
  try{
   const fixtures=readPrivate(this.fixtureFile),fixture=fixtures.jobs?.[current.job.id],origin=fixtures.origin;
   if(fixtures.version!==1||!fixture||JSON.stringify(fixture.scope)!==JSON.stringify(current.scope)||fixture.layout!==current.browser?.layout||fixture.scenario!==current.browser?.scenario||!/^[-a-zA-Z0-9]{1,100}$/.test(fixture.token))throw Error('PROFILE_UNAVAILABLE');
   const key=createHash('sha256').update(JSON.stringify([origin,current.scope.companyId,current.scope.supplierId,current.scope.accountId])).digest('hex');
   const profile=resolve('.sites-runtime/po-cart-workers/browser-profiles',key);unlock=profileLock(profile);
   marker.phase='opening';this.save();
   assertGateSource();registerGateProfile(profile);session=await openLocalCartBrowser(origin,profile,this.headless,current.session.purpose,accessAllowed);this.activeSession=session;
   if(!accessAllowed())throw Error('ACCESS_LOST');
   await session.page.goto(origin+'/session/'+fixture.token,{waitUntil:'networkidle',timeout:10000});
   const read=async()=>{try{return await readCart(session!.page,origin);}catch(e){if((e as Error).message==='LOGIN_REQUIRED')return null;throw e;}};
   const openedCart=await read();marker.phase='open';this.save();
   current=(await this.mutate('opened',{sessionId,fence,cart:openedCart})).current;
   let lastBeat=Date.now();
   while(true){
    if(this.stopping)throw Error('SHUTDOWN');
    if(timedOut)throw Error('ACCESS_LOST');
    if(session.page.isClosed()||!session.driver.isConnected())throw Error('BROWSER_CLOSED');
    current=(await this.http('GET',null,sessionId)).data.current;
    if(!current.session.allowed)throw Error('ACCESS_LOST');
    if(current.session.state==='closing'){
     const cart=await read();
     // Browser closure completes before the durable completion request, including all HTTP retries.
     await closeLocalCartBrowser(session,true);session=undefined;this.activeSession=undefined;
     marker.phase='closed';marker.cart=cart;this.save();
     await this.mutate('complete',{sessionId,fence,cart});finished=true;break;
    }
    if(Date.now()-lastBeat>=20000){await this.mutate('heartbeat',{sessionId,fence});lastBeat=Date.now();}
    await new Promise(ok=>setTimeout(ok,500));
   }
  }catch(e){
   if(session){await closeLocalCartBrowser(session).catch(()=>{});session=undefined;this.activeSession=undefined;}
   await this.stopDurably(sessionId,fence,(e as Error).message==='BROWSER_CLOSED'?'browser_closed':(e as Error).message==='SHUTDOWN'?'shutdown':!unlock?'profile_busy':'connection_lost');
   throw Error('Supervised browser stopped. Private evidence retained.');
  }finally{
   clearInterval(watchdog);if(session)await closeLocalCartBrowser(session).catch(()=>{});this.activeSession=undefined;unlock?.();
   if(finished){this.state.human=null;this.save();}
  }
 }
}
