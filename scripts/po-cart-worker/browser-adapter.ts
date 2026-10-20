import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {FakeCartWorker} from './client.mjs';
import {readPrivate,profileLock} from './private-files.mjs';
import {assertGateSource,registerGateProfile,gateActive} from './full-gate-runtime.mjs';
import {cleanupTaskBrowser} from './second-addition-cleanup.mjs';
import {openLocalCartBrowser,closeLocalCartBrowser,readCart,readProducts,exactProduct} from '../cart-preview/browser-session';
import {verifyCart,exactEntry,type CartEntry,type CartLine} from '../../src/lib/cart-preview-contract';
import {agreeProduct,agreeCart,type CartReader} from './ai-reader';
import {browserDiagnostics} from './browser-diagnostics';

// JS client owns HTTP retries, serialized mutations, permanent operation UUIDs and private fsynced recovery.
export class LocalBrowserCartWorker extends FakeCartWorker {
  stopping=false;activeSession:Awaited<ReturnType<typeof openLocalCartBrowser>>|undefined;
  inferenceAbort=new AbortController();
  requestStop(){this.diagnostic.emit('stop');this.stopping=true;this.inferenceAbort.abort();void this.activeSession?.browser.close().catch(()=>{});}
  fixtureFile:string;profileRoot:string;headless:boolean;
  reader?:CartReader;
  retainFailureMessage:boolean;
  diagnosticMode:'off'|'passive'|'form';
  diagnostic:ReturnType<typeof browserDiagnostics>;
  constructor(options:{credentialFile:string;journalFile:string;origin?:string;fetchImpl?:typeof fetch;timeoutMs?:number;fixtureFile:string;headless?:boolean;reader?:CartReader;diagnosticFile?:string;diagnosticMode?:'off'|'passive'|'form';diagnosticStream?:ReturnType<typeof browserDiagnostics>;retainFailureMessage?:boolean}){
    super(options);this.fixtureFile=options.fixtureFile;this.profileRoot=resolve('.sites-runtime/po-cart-workers/browser-profiles');this.headless=options.headless??true;
    this.reader=options.reader;this.retainFailureMessage=gateActive()?false:options.retainFailureMessage??true;
    this.diagnosticMode=options.diagnosticMode??(options.diagnosticFile?'form':'off');
    if(this.diagnosticMode!=='off'&&!options.diagnosticFile){super.close();throw Error('Private diagnostic file required.');}
    try{this.diagnostic=options.diagnosticStream??browserDiagnostics(this.diagnosticMode==='off'?undefined:options.diagnosticFile);}catch(e){super.close();throw e;}
  }
  close(){this.diagnostic.close();super.close();}
  async process(current:any){
    const jobId=current.job.id;
    if(current.job.state==='preparing'&&Date.parse(current.ownership?.leaseUntil)<=Date.now())current=(await this.mutate('recoverExpired',{jobId})).current;
    if(current.job.state==='queued')current=(await this.mutate('claim',{jobId})).current;
    const fence=current.ownership?.fence;if(!this.owns(current,fence))return;
    if(!current.browser)throw Error('Browser job required.');
    let stage='session',ownedProfile:string|undefined;
    let session:Awaited<ReturnType<typeof openLocalCartBrowser>>|undefined,unlock:(()=>void)|undefined,heartbeatFailure:unknown=null;
    const emit=this.diagnostic.emit;
    let lifecycle:import('../cart-preview/browser-session').BrowserEvidence|undefined;
    const heartbeat=setInterval(()=>{emit('heartbeat_start');void this.mutate('heartbeat',{jobId,fence}).then(()=>emit('heartbeat_ok')).catch((e:unknown)=>{emit('heartbeat_failed');heartbeatFailure=e;this.inferenceAbort.abort();void session?.browser.close().catch(()=>{});});},20000);
    const fresh=async()=>{
      if(this.stopping)throw Error('STOPPED');
      if(heartbeatFailure)throw heartbeatFailure;
      emit('ownership_check');let next;try{next=(await this.http('GET',null,jobId)).data.current;}
      catch(e){emit('ownership_lost',{status:(e as any).status??503});throw e;}
      if(!this.owns(next,fence)){emit('ownership_lost');throw Error('OWNERSHIP_LOST');}emit('ownership_ok');return next;
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
      ownedProfile=resolve(this.profileRoot,key);
      current=await fresh();stage='launch';assertGateSource();registerGateProfile(resolve(this.profileRoot,key));session=await openLocalCartBrowser(origin,resolve(this.profileRoot,key),this.headless,'automation',()=>true,emit,{onEvidence:e=>{lifecycle=e;this.state.browserNetwork={jobId,...e};this.save();}});this.activeSession=session;
      const {page}=session;await page.goto(origin+'/session/'+fixture.token,{waitUntil:'networkidle',timeout:10000});
      const aiContext=(phase:string)=>({caseId:jobId,phase,signal:this.inferenceAbort.signal,diagnostic:emit});
      const readWithAi=async(phase:string)=>{
        emit('inspection_start');const observed=await readCart(page,origin);emit('inspection_ok',{count:observed.length});
        if(!this.reader)return observed;
        const ai=await this.reader.cart(session!,aiContext(phase));
        await fresh();const trusted=await readCart(page,origin);agreeCart(ai,trusted);agreeCart({entries:observed},trusted);
        this.state.aiReads??=[];this.state.aiReads.push({jobId,phase,agreed:true});this.save();return trusted;
      };
      stage='baseline';const initialCart=await readWithAi('baseline');let baseline:CartEntry[]=initialCart;
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
        emit('catalog_ready');
        // Even unsafe fixtures reach the model; a deterministic early stop is
        // never counted as real-AI safety evidence. Exact matching remains independent.
        const ai=this.reader?await this.reader.discover(session,line,aiContext('product:'+line.sku)):undefined;
        await fresh();
        if(this.reader){
          verifyCart(baseline,current.lines,await readCart(page,origin),attempted);
          await page.goto(origin+'/catalog',{waitUntil:'networkidle',timeout:10000});
          if(await page.locator('[data-login]').count())throw Error('LOGIN_REQUIRED');
          emit('catalog_ready');
        }
        const index=exactProduct(await readProducts(page),line),selector=`[data-product="${index}"]`;
        if(this.reader){agreeProduct(ai,index,line);this.state.aiReads??=[];this.state.aiReads.push({jobId,phase:'product:'+line.sku,agreed:true});this.save();}
        await page.locator(`${selector} input[name="packs"]`).fill(line.packs);
        emit('quantity_filled');
        if(this.diagnostic.enabled&&this.diagnosticMode==='form'){const readiness=await page.locator(`${selector} form`).evaluate(form=>{
          const f=form as HTMLFormElement,b=f.querySelector('button') as HTMLButtonElement;
          const events={clicked:false,submitted:false,invalid:false};(window as any).__cartFormEvents=events;
          b.addEventListener('click',()=>{events.clicked=true;});f.addEventListener('submit',()=>{events.submitted=true;});f.addEventListener('invalid',()=>{events.invalid=true;},true);
          return {valid:f.checkValidity(),enabled:!b.disabled,focused:f.contains(document.activeElement)};
        });emit('form_ready',readiness);}
        stage='begin';const begun=await this.mutate('beginAttempt',{jobId,fence,lineId:(line as any).lineId});
        if(!begun.providerCallAllowed||begun.receipt.fence!==fence||!begun.receipt.attemptId||!this.owns(begun.current,fence)){
          await this.recoverJournal();return;
        }
        emit('attempt_ack');
        await fresh();
        // Durable marker precedes one browser addition. No retry is allowed, including after interruption.
        this.state.calls.push({jobId,lineId:(line as any).lineId,attemptId:begun.receipt.attemptId});this.save();
        if(exactProduct(await readProducts(page),line)!==index)throw Error('CHANGED_PRODUCT');
        stage='addition';emit('click_start');let response;
        try{[response]=await Promise.all([page.waitForResponse(r=>r.url()===origin+'/add'&&r.request().method()==='POST',{timeout:10000}),
          (emit('click_dispatch'),page.locator(`${selector} button`).click({noWaitAfter:true})).then(()=>emit('click_done'))]);}
        catch(e){emit('click_failed',{connected:session.driver.isConnected()});if(this.diagnostic.enabled&&this.diagnosticMode==='form')try{emit('form_events',await page.evaluate(()=>(window as any).__cartFormEvents??{}));}catch{}throw e;}
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
      stage='final';await fresh();const cart=await readWithAi('final');await fresh();
      await this.mutate('finalizeCart',{jobId,fence,cart});
    }catch(e){
      emit('failure',{connected:session?.driver.isConnected()??false});
      this.state.browserFailure={stage,message:this.retainFailureMessage?(e as Error).message.split('\n')[0].replace(/https?:\/\/\S+/g,'[private URL]').slice(0,160):'Browser preparation failed.'};this.save();
      // Safe HTTP recovery can publish known results; it can never recreate an ephemeral begin grant.
      if(!this.state.pending){
        try{const next=await fresh();if(this.owns(next,fence))await this.mutate('hold',{jobId,fence,reason:
          this.state.attempt?'uncertain_write':(e as Error).message==='LOGIN_REQUIRED'?'sign_in_required':
          (e as Error).message==='CHANGED_PRODUCT'?'changed_product':(e as Error).message==='SESSION_UNAVAILABLE'?'session_unavailable':'verification_failed'});}
        catch{/* Revocation, cancellation, source change or lease loss leaves durable recovery/exposure intact. */}
      }
      throw Error('Browser preparation stopped; private evidence retained.');
    }finally{
      clearInterval(heartbeat);
      try{await this.queue;}finally{
        try{if(session)await closeLocalCartBrowser(session);if(gateActive()&&ownedProfile)await cleanupTaskBrowser(ownedProfile);}finally{
          if(lifecycle){this.state.browserNetwork={jobId,...lifecycle};this.save();}
          this.activeSession=undefined;unlock?.();
        }
      }
    }
  }
}
