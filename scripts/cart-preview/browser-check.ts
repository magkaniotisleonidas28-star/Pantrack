import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CartStore} from './store';
import {CartBrowser} from './browser';
import {catalog,startFixture} from './fixture';
import type {PurchaseOrderView} from '../../src/lib/purchase-order-contract';
import {gateActive} from '../po-cart-worker/full-gate-runtime.mjs';
import {fullGateRoot} from '../po-cart-worker/acceptance-gate.mjs';
const root=gateActive()?fullGateRoot+'/cart-browser-fixtures':mkdtempSync(join(tmpdir(),'pantrack-cart-browser-')),store=new CartStore(root),fixture=await startFixture(store,5184),browser=new CartBrowser(store,'http://127.0.0.1:5184',!process.argv.includes('--visible'));
const results:unknown[]=[];
try{
  for(const layout of ['rows','compact'] as const)for(const scenario of ['normal','unavailable','price_changed','wrong_pack','ambiguous','lost_response','login_expired','malicious'] as const){
    const companyId=randomUUID(),orderId=randomUUID(),order={revision:2,status:'reviewed',snapshot:{companyId,id:orderId,supplier:{id:'cart-demo-supplier',accountId:'DEMO-CART',locationId:'DEMO-CAFE'},lines:catalog.map((l,i)=>({...l,packs:String(i+1),estimatedUnitMinor:l.unitMinor}))}} as unknown as PurchaseOrderView;
    const job=store.create({action:'start',companyId,orderId,expectedRevision:2,operationId:randomUUID(),layout,scenario},'fixture-manager',order);
    await browser.run(job,async()=>true);
    if(scenario==='lost_response'){assert.equal(job.state,'needs_review');await browser.run(job,async()=>true);}
    if(scenario==='login_expired'){assert.equal(job.state,'awaiting_login');const s=await browser.session(job);await s.page.locator('button').click();await s.page.waitForSelector('[data-product]');await s.page.waitForLoadState('networkidle');await browser.run(job,async()=>true);}
    const success=['normal','lost_response','login_expired','malicious'].includes(scenario);
    assert.equal(job.state,success?'ready':'needs_review',job.message);
    const cart=store.state.fixtures[job.session].entries;assert.equal(cart.find(e=>e.sku==='EXISTING')?.packs,'1');
    if(success){for(const l of job.input)assert.equal(cart.filter(e=>e.sku===l.sku&&e.packs===l.packs&&e.unitLabel===l.unitLabel&&e.unitMinor===l.unitMinor).length,1);assert.equal(cart.length,job.input.length+1);await browser.inspect(job);}
    else assert.equal(cart.length,1,'Failed preflight must preserve baseline');
    results.push({layout,scenario,state:job.state,elapsedMs:job.elapsedMs,interventions:job.interventions});console.log(`PASS ${layout}/${scenario}: ${job.state}`);
    await browser.close();
  }
  writeFileSync(gateActive()?fullGateRoot+'/cart-browser-results.json':'.sites-runtime/cart-browser-results.json',JSON.stringify({evidence:'offline-real-browser',results},null,2),{mode:0o600});
}finally{await browser.close();await new Promise<void>(ok=>fixture.close(()=>ok()));if(!gateActive())rmSync(root,{recursive:true,force:true});}
