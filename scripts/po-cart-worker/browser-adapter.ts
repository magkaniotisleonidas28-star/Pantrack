import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {FakeCartWorker} from './client.mjs';
import {readPrivate,profileLock} from './private-files.mjs';
import {openLocalCartBrowser,closeLocalCartBrowser,readCart,readProducts,exactProduct} from '../cart-preview/browser-session';
import {verifyCart,exactEntry,type CartEntry,type CartLine} from '../../src/lib/cart-preview-contract';

// JS client owns HTTP retries, serialized mutations, permanent operation UUIDs and private fsynced recovery.
export class LocalBrowserCartWorker extends FakeCartWorker {
  stopping=false;activeSession:Awaited<ReturnType<typeof openLocalCartBrowser>>|undefined;
  requestStop(){this.stopping=true;void this.activeSession?.browser.close().catch(()=>{});}
  fixtureFile:string;profileRoot:string;headless:boolean;
  constructor(options:{credentialFile:string;journalFile:string;origin?:string;fetchImpl?:typeof fetch;timeoutMs?:number;fixtureFile:string;headless?:boolean}){
    super(options);this.fixtureFile=options.fixtureFile;this.profileRoot=resolve('.sites-runtime/po-cart-workers/browser-profiles');this.headless=options.headless??true;
  }
  async process(current:any){
    const jobId=current.job.id;
    if(current.job.state==='preparing'&&Date.parse(current.ownership?.leaseUntil)<=Date.now())current=(await this.mutate('recoverExpired',{jobId})).current;
    if(current.job.state==='queued')current=(await this.mutate('claim',{jobId})).current;
    const fence=current.ownership?.fence;if(!this.owns(current,fence))return;
    if(!current.browser)throw Error('Browser job required.');
    let stage='session';
    let session:Awaited<ReturnType<typeof openLocalCartBrowser>>|undefined,unlock:(()=>void)|undefined,heartbeatFailure:unknown=null;
    const heartbeat=setInterval(()=>{void this.mutate('heartbeat',{jobId,fence}).catch((e:unknown)=>{heartbeatFailure=e;void session?.browser.close().catch(()=>{});});},20000);
    const fresh=async()=>{
      if(this.stopping)throw Error('STOPPED');
      if(heartbeatFailure)throw heartbeatFailure;
      const next=(await this.http('GET',null,jobId)).data.current;
      if(!this.owns(next,fence))throw Error('OWNERSHIP_LOST');return next;
    };
    try{
      current=await fresh();
      // An existing attempt never authorizes a browser restart/addition. Known results were replayed by recoverJournal.
      if(current.attempts.length){await this.mutate('hold',{jobId,fence,reason:'uncertain_write'});return;}
      const fixtures=readPrivate(this.fixtureFile),fixture=fixtures.jobs?.[jobId];
      if(fixtures.version!==1||!fixture||JSON.stringify(fixture.scope)!==JSON.stringify(current.scope)
        ||fixture.layout!==current.browser.layout||fixture.scenario!==current.browser.scenario||!/^[-a-zA-Z0-9]{1,100}$/.test(fixture.token))throw Error('SESSION_UNAVAILABLE');
      const origin=fixtures.origin,u=new URL(origin);
      if(u.hostname!=='127.0.0.1'||u.protocol!=='http:'||u.origin!==origin)throw Error('SESSION_UNAVAILABLE');
      const key=createHash('sha256').update(JSON.stringify([origin,current.scope.companyId,current.scope.supplierId,current.scope.accountId])).digest('hex');
      mkdirSync(this.profileRoot,{recursive:true,mode:0o700});
      // Lock lifetime belongs to the local process, not the D1 lease. Chromium also keeps its own profile lock.
      unlock=profileLock(resolve(this.profileRoot,key));
      current=await fresh();stage='launch';session=await openLocalCartBrowser(origin,resolve(this.profileRoot,key),this.headless);this.activeSession=session;
      const {page}=session;await page.goto(origin+'/session/'+fixture.token,{waitUntil:'networkidle',timeout:10000});
      stage='baseline';const initialCart=await readCart(page,origin);let baseline:CartEntry[]=initialCart;
      if(current.verification.some((e:any)=>e.kind==='baseline')){
        current=(await this.mutate('verifyBaseline',{jobId,fence,cart:initialCart})).current;
        if(!this.owns(current,fence))return;
        baseline=initialCart;
      }
      if(!current.verification.some((e:any)=>e.kind==='baseline')){
        current=(await this.mutate('recordBaseline',{jobId,fence,cart:baseline})).current;
        if(!this.owns(current,fence))return;
      }
      this.state.baseline={jobId,cart:baseline};this.save();
      const attempted:string[]=[];
      for(const line of current.lines as CartLine[]){
        current=await fresh();
        stage='catalog';const before=await readCart(page,origin);verifyCart(baseline,current.lines,before,attempted);
        await page.goto(origin+'/catalog',{waitUntil:'networkidle',timeout:10000});
        if(await page.locator('[data-login]').count())throw Error('LOGIN_REQUIRED');
        const index=exactProduct(await readProducts(page),line),selector=`[data-product="${index}"]`;
        await page.locator(`${selector} input[name="packs"]`).fill(line.packs);
        stage='begin';const begun=await this.mutate('beginAttempt',{jobId,fence,lineId:(line as any).lineId});
        if(!begun.providerCallAllowed||begun.receipt.fence!==fence||!begun.receipt.attemptId||!this.owns(begun.current,fence)){
          await this.recoverJournal();return;
        }
        await fresh();
        // Durable marker precedes one browser addition. No retry is allowed, including after interruption.
        this.state.calls.push({jobId,lineId:(line as any).lineId,attemptId:begun.receipt.attemptId});this.save();
        if(exactProduct(await readProducts(page),line)!==index)throw Error('CHANGED_PRODUCT');
        stage='addition';const [response]=await Promise.all([page.waitForResponse(r=>r.url()===origin+'/add'&&r.request().method()==='POST',{timeout:10000}),
          page.locator(`${selector} button`).click({noWaitAfter:true})]);
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{const failed=await Promise.race([response.finished(),new Promise<Error>(ok=>{timer=setTimeout(()=>ok(Error('UNCERTAIN_WRITE')),10000);})]);if(failed)throw Error('UNCERTAIN_WRITE');}
        finally{clearTimeout(timer);}
        await page.waitForURL(origin+'/cart',{waitUntil:'networkidle',timeout:10000});
        stage='verify_line';const cart=await readCart(page,origin);attempted.push(line.sku);
        verifyCart(baseline,current.lines,cart,attempted);
        if(!cart.some(e=>exactEntry(e,line)))throw Error('VERIFICATION_FAILED');
        // Derive the complete line result only from exact independent cart observation.
        this.state.attempt.outcome={...current.lines.find((l:any)=>l.lineId===(line as any).lineId),
          ...cart.find(e=>e.sku===line.sku)};this.save();
        current=(await this.mutate('recordResult',{jobId,fence,attemptId:begun.receipt.attemptId,outcome:'verified',observation:this.state.attempt.outcome})).current;
      }
      stage='final';await fresh();const cart=await readCart(session.page,origin);
      await this.mutate('finalizeCart',{jobId,fence,cart});
    }catch(e){
      this.state.browserFailure={stage,message:(e as Error).message.split('\n')[0].replace(/https?:\/\/\S+/g,'[private URL]').slice(0,160)};this.save();
      // Safe HTTP recovery can publish known results; it can never recreate an ephemeral begin grant.
      if(!this.state.pending){
        try{const next=await fresh();if(this.owns(next,fence))await this.mutate('hold',{jobId,fence,reason:
          this.state.attempt?'uncertain_write':(e as Error).message==='LOGIN_REQUIRED'?'sign_in_required':
          (e as Error).message==='CHANGED_PRODUCT'?'changed_product':(e as Error).message==='SESSION_UNAVAILABLE'?'session_unavailable':'verification_failed'});}
        catch{/* Revocation, cancellation, source change or lease loss leaves durable recovery/exposure intact. */}
      }
      throw Error('Browser preparation stopped; private evidence retained.');
    }finally{clearInterval(heartbeat);await this.queue;if(session)await closeLocalCartBrowser(session);this.activeSession=undefined;unlock?.();}
  }
}
