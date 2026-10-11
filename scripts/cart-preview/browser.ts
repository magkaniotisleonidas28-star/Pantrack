import type {StagehandBrowser} from '@browserbasehq/stagehand';
import {openLocalCartBrowser,readCart,readProducts,exactProduct} from './browser-session';
export {browserProxy} from './browser-session';
import type {Browser,Page} from 'playwright-core';
import type {Server} from 'node:http';
import {resolve} from 'node:path';
import {verifyCart,type CartEntry,type CartLine} from '../../src/lib/cart-preview-contract';
import type {CartStore,Job} from './store';
import {inferProduct,type Product} from './model';
const canceled=(job:Job)=>job.state==='canceled';
export class CartBrowser{
  sessions=new Map<string,{browser:StagehandBrowser;driver:Browser;page:Page;proxy:Server}>();
  running=new Set<string>();
  tasks=new Map<string,Promise<void>>();
  constructor(readonly store:CartStore,readonly origin='http://127.0.0.1:5182',readonly headless=false){}
  async session(job:Job){
    const old=this.sessions.get(job.id);if(old&&old.driver.isConnected()&&!old.page.isClosed())return old;
    if(old){await old.browser.close().catch(()=>{});old.proxy.close();this.sessions.delete(job.id);}
    const result=await openLocalCartBrowser(this.origin,resolve(this.store.path,'profiles',job.session),this.headless);
    this.sessions.set(job.id,result);
    try{await result.page.goto(this.origin+'/session/'+this.store.state.fixtures[job.session].token,{waitUntil:'networkidle',timeout:10000});return result;}
    catch(e){await result.browser.close().catch(()=>{});result.proxy.close();this.sessions.delete(job.id);throw e;}
  }
  async readCart(page:Page){return readCart(page,this.origin);}
  async products(page:Page):Promise<Product[]>{return readProducts(page);}
  async candidate(job:Job,page:Page,line:CartLine){
    const products=await this.products(page),p={index:exactProduct(products,line)};
    const index=job.mode==='ai'?await inferProduct(this.store,products,line):p.index;
    if(index!==p.index)throw Error('AI could not identify the exact product. Review required.');
    return index;
  }
  run(job:Job,current:()=>Promise<boolean>){
    const old=this.tasks.get(job.id);if(old)return old;
    const task=this.execute(job,current).finally(()=>this.tasks.delete(job.id));this.tasks.set(job.id,task);return task;
  }
  private async execute(job:Job,current:()=>Promise<boolean>){
    if(this.running.has(job.id)||job.state==='ready'||job.state==='canceled')return;
    this.running.add(job.id);this.store.update(job,'preparing','Checking existing cart…');
    try{
      const {page}=await this.session(job);let cart=await this.readCart(page);
      if(job.baseline===null){if(cart.some(e=>job.input.some(l=>l.sku===e.sku)))throw Error('A requested SKU is already in the cart. Review it before preparing.');job.baseline=cart;this.store.save();}
      job.verified=verifyCart(job.baseline,job.input,cart,job.attempted);this.store.save();
      for(const line of job.input){
        if(canceled(job)||!await current())return;
        // Reconcile every write, including when the previous response was lost.
        cart=await this.readCart(page);job.verified=verifyCart(job.baseline,job.input,cart,job.attempted);
        if(job.verified.includes(line.sku))continue;
        await page.goto(this.origin+'/catalog',{waitUntil:'networkidle',timeout:10000});if(await page.locator('[data-login]').count())throw Error('LOGIN_REQUIRED');
        const index=await this.candidate(job,page,line);
        if(canceled(job)||!await current())return;
        // Index is trusted only after independent DOM matching; model never supplies executable selectors.
        const selector=`[data-product="${index}"]`;
        await page.locator(`${selector} input[name="packs"]`).fill(line.packs);
        if(!job.attempted.includes(line.sku))job.attempted.push(line.sku);this.store.save();
        await page.locator(`${selector} button`).click();
        await page.waitForSelector('[data-cart-item]',{timeout:5000});
        await page.waitForLoadState('networkidle',{timeout:10000});
        if(job.scenario==='lost_response'&&job.verified.length===0)throw Error('Response lost after cart change. Resume to verify the existing cart.');
        this.store.update(job,'preparing',`Checking ${line.description}…`);
      }
      if(canceled(job)||!await current())return;
      cart=await this.readCart(page);job.verified=verifyCart(job.baseline,job.input,cart,job.attempted);
      if(job.verified.length!==job.input.length)throw Error('Cart verification incomplete. Review required.');
      this.store.update(job,'ready','Cart verified. Switch to the supplier browser to review; no order has been placed.');
    }catch(e){if(!canceled(job)){job.interventions++;const login=(e as Error).message==='LOGIN_REQUIRED';this.store.update(job,login?'awaiting_login':'needs_review',login?'Sign in to the practice account in the supplier browser, then resume.':(e as Error).message);}}
    finally{this.running.delete(job.id);}
  }
  async inspect(job:Job){
    if(this.running.has(job.id))throw Error('Wait for preparation to stop before taking over.');
    const session=await this.session(job);await session.page.bringToFront();
    // Login page is preserved when waiting for manager sign-in.
    if(job.state==='ready')try{const cart=await this.readCart(session.page);const checked=verifyCart(job.baseline??[],job.input,cart,job.attempted);if(checked.length!==job.input.length)throw Error('Cart changed after verification. Review required.');}
    catch(e){this.store.update(job,'needs_review',(e as Error).message);throw e;}
  }
  async close(){for(const s of this.sessions.values()){await s.driver.close().catch(()=>{});await s.browser.close().catch(()=>{});s.proxy.close();}await Promise.allSettled([...this.tasks.values()]);this.sessions.clear();}
}
