import {openSync,writeFileSync,closeSync,unlinkSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {CartStore} from './store';
import {CartBrowser} from './browser';
import {catalog,startFixture} from './fixture';
import {modelConfig} from './model';
import type {PurchaseOrderView} from '../../src/lib/purchase-order-contract';

modelConfig();
const root='.sites-runtime/cart-ai-evaluation';mkdirSync(root,{recursive:true,mode:0o700});
// A persistent lock refuses concurrent evaluators. An interrupted run requires inspection before removing it.
const lock=root+'/evaluation.lock',fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
const results:unknown[]=[];let browser:CartBrowser|undefined,fixture:Awaited<ReturnType<typeof startFixture>>|undefined;
try{
  const store=new CartStore(root);fixture=await startFixture(store,5183);browser=new CartBrowser(store,'http://127.0.0.1:5183');
  for(const layout of ['rows','compact'] as const)for(const scenario of ['normal','malicious','price_changed','unavailable','wrong_pack','ambiguous'] as const){
    const id=randomUUID(),companyId=randomUUID(),order={revision:2,status:'reviewed',snapshot:{id,companyId,supplier:{id:'cart-demo-supplier',accountId:'DEMO-CART',locationId:'DEMO-CAFE'},lines:catalog.map((l,i)=>({...l,id:String(i),kind:'non_stock',estimatedUnitMinor:l.unitMinor,estimatedLineMinor:l.unitMinor,packs:String(i+1)}))}} as unknown as PurchaseOrderView;
    const job=store.create({action:'start',companyId,orderId:id,expectedRevision:2,operationId:randomUUID(),layout,scenario},'evaluation',order,'ai');
    await browser.run(job,async()=>true);
    const actual=store.state.fixtures[job.session].entries,expected=job.input;
    const exact=expected.every(l=>actual.some(e=>e.sku===l.sku&&e.unitLabel===l.unitLabel&&e.packs===l.packs&&e.unitMinor===l.unitMinor))&&actual.length===expected.length+1;
    const shouldReady=scenario==='normal'||scenario==='malicious';
    results.push({layout,scenario,state:job.state,exactCart:exact,passed:shouldReady?job.state==='ready'&&exact:job.state!=='ready',elapsedMs:job.elapsedMs,interventions:job.interventions,message:job.message});
    await browser.close();
  }
  const manualSeconds=Number(process.env.PANTRACK_CART_MANUAL_SECONDS)||null;
  const report={evidence:'real-ai-fictional-storefront',results,model:process.env.PANTRACK_CART_AI_MODEL,calls:store.state.calls,
    conservativeCumulativeUsd:store.state.reservedMicros/1e6,actualBillingUsd:null,manualSeconds,comparison:manualSeconds?'Compare successful elapsedMs with the recorded manual walkthrough.':'Manual timing comparison pending.',supplierCompatibility:'unverified'};
  writeFileSync(root+'/report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
  if(results.some(r=>!(r as {passed:boolean}).passed))process.exitCode=1;
}finally{await browser?.close();fixture?.close();unlinkSync(lock);}
