import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {fixture,core} from './supplier-simulation.mjs';
await build({stdin:{contents:['d1-po-cart-authorizations','d1-purchase-order-drafts','d1-purchasing-suppliers']
  .map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/durable-po-cart-tests.mjs'});
export const cartCore=await import('../../.sites-runtime/durable-po-cart-tests.mjs');
export const supplier={id:'cart-demo-supplier',name:'Fictional cart',email:'orders@example.invalid',
  accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'};
export const connection={companyId:'a',id:'demo-connection',version:1,supplierId:supplier.id,
  accountId:supplier.accountId,locationId:supplier.locationId,mode:'fictional',status:'active',paused:false};
export function configure(sql,companyId='a'){
  sql.prepare('INSERT INTO po_cart_connections VALUES(?,?,?,?)').run(companyId,connection.id,1,JSON.stringify({...connection,companyId}));
  // Explicit test policy. Never a runtime default or real spending approval.
  sql.prepare('INSERT INTO po_cart_budget_policies VALUES(?,?,?,?)').run(companyId,1,50000,100000);
}
export function connectionVersion(sql,patch){
  const version=sql.prepare("SELECT MAX(version)+1 AS v FROM po_cart_connections WHERE company_id='a' AND id=?").get(connection.id).v;
  const next={...connection,...patch,version};
  sql.prepare('INSERT INTO po_cart_connections VALUES(?,?,?,?)').run('a',connection.id,version,JSON.stringify(next));return next;
}
export const command=order=>({action:'authorize',companyId:order.snapshot.companyId,orderId:order.snapshot.id,
  expectedRevision:order.revision,operationId:randomUUID()});
export const cancelCommand=(a,reason='Cancel fictional preparation')=>({action:'cancel',companyId:a.companyId,
  authorizationId:a.id,expectedRevision:a.revision,operationId:randomUUID(),reason});
export const errorCode=code=>error=>error.code===code;
export function tables(sql,names){return JSON.stringify(names.map(name=>[name,sql.prepare(`SELECT * FROM "${name}"`).all()]));}
export const cartTables=['po_cart_authorizations','po_cart_commitments','po_cart_reservations','po_cart_events','po_cart_operations'];
export async function cartFixture(){
  const f=await fixture();configure(f.sql);
  const drafts=new cartCore.D1PurchaseOrderDrafts(f.db,f.options),service=()=>new cartCore.D1PoCartAuthorizations(f.db,f.options);
  const actor={companyId:'a',userId:'manager',role:'manager'};
  const lifecycle=new core.D1ReplenishmentLifecycle(f.db,f.options);
  async function stock(productId){
    const h=await f.source({productId});
    await lifecycle.cancel({companyId:'a',proposalId:h.proposalId,expectedRevision:h.revision,changeId:randomUUID(),actor,reason:'Use manual PO fixture'});
    return {kind:'stock',productId,expectedConfigId:`config-${productId}`,expectedConfigVersion:1,sku:`SKU-${productId}`,
      description:productId,packs:'2',estimatedUnitMinor:'100'};
  }
  async function proposed(productId,{clover=false}={}){
    await stock(productId);
    const request={companyId:'a',id:`cart-proposal-${productId}`,createId:randomUUID(),productId,actor,
      supplier:{companyId:'a',source:'fictional_fixture',mappingId:`mapping-${productId}`,mappingVersion:1,
        supplierId:supplier.id,accountId:supplier.accountId,locationId:supplier.locationId,sku:`SKU-${productId}`},
      priceEstimate:{companyId:'a',source:'fictional_fixture',currency:'USD',perPackMinor:'900'}};
    if(clover){
      const now=f.options.clock.now().getTime();
      f.sql.prepare('INSERT OR IGNORE INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES(?,?,?,?,?,?,0)')
        .run('a','merchant-a','sandbox','fictional-placeholder',f.options.clock.now().toISOString(),f.options.clock.now().toISOString());
      f.sql.prepare('INSERT OR IGNORE INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until) VALUES(?,?,?,?,?,?,?,?,0)')
        .run('a','sandbox','merchant-a',now-120000,now-60000,f.options.clock.now().toISOString(),new Date(now-60000).toISOString(),null);
      await new core.D1ReplenishmentProposalOrigins(f.db,f.options).createWithClover(request,f.options.salesPolicy);
    }else await new core.D1ReplenishmentProposalOrigins(f.db,f.options).create({...request,sales:{companyId:'a',source:'fictional_fixture',status:'current',heldEventCount:0}});
    return (await lifecycle.get('a',request.id,actor)).handoff;
  }
  function createInput(extra={}){const input={action:'create',companyId:'a',operationId:randomUUID(),source:'manual',supplier,
    capMinor:'15000',notes:'Fictional preparation',lines:[{kind:'non_stock',sku:'SUPPLIES',description:'Supplies',unitLabel:'case',packs:'1',estimatedUnitMinor:'100'}],...extra};
    if(input.source==='proposals')delete input.lines;return input;}
  async function reviewed(extra={}){
    let order=await drafts.create(createInput(extra));
    order=await drafts.review({...command(order),action:'review',acknowledgeWarnings:true});return order;
  }
  return {...f,drafts,service,stock,proposed,reviewed,createInput,actor,lifecycle};
}
