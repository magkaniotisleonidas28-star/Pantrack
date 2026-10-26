import assert from 'node:assert/strict';
import {historyFixture,core} from './helpers/purchase-order-history-export.mjs';
const fails=(promise,code)=>assert.rejects(promise,error=>error.code===code);
const f=await historyFixture();
try{
  const orders=[];
  for(let n=0;n<27;n++){
    let order=await f.drafts.create(f.create());
    if(n===0)order=await f.review(order);if(n===1)order=await f.cancel(order);orders.push(order);
  }
  const literal=await f.drafts.create(f.create({supplier:{...f.supplier,id:'literal',name:"Literal %_ ' OR 1=1--"}}));
  f.state.user='b-manager';await f.drafts.create(f.create({companyId:'b'}));f.state.user='manager';
  const before=f.allTables(),snapshot=await f.history.get({companyId:'a'});
  assert.equal(snapshot.orderCount,28);assert.equal(snapshot.lineCount,28);assert.equal(f.state.historyReads,1);
  assert.equal(snapshot.records.find(r=>r.draft.id===orders[0].snapshot.id).status,'reviewed');
  assert.equal(snapshot.records.find(r=>r.draft.id===orders[1].snapshot.id).status,'canceled');
  assert.ok(Object.isFrozen(snapshot.records[0].draft.lines[0]));
  assert.equal((await core.verifyPurchaseOrderHistoryExport(snapshot)).fingerprint,snapshot.fingerprint);
  assert.deepEqual(await f.history.get({companyId:'a',expected:snapshot.fingerprint}),snapshot);
  for(const user of [null,'employee','b-manager']){f.state.user=user;await fails(f.history.get({companyId:'a'}),'forbidden');}
  f.state.user='manager';await fails(f.history.get({companyId:'b'}),'forbidden');
  for(const user of ['owner','manager']){f.state.user=user;assert.equal((await f.history.get({companyId:'a'})).orderCount,28);}
  for(const filters of [{q:'%_'},{q:"' OR 1=1--"},{supplier:'LITERAL'}]){
    const found=await f.history.get({companyId:'a',filters});assert.equal(found.orderCount,1);assert.equal(found.records[0].draft.id,literal.snapshot.id);
  }
  for(const status of ['reviewed','canceled'])assert.equal((await f.history.get({companyId:'a',filters:{supplier:'FAKE',status}})).orderCount,1);
  await fails(f.history.get({companyId:'a',filters:{q:'no such supplier'}}),'empty');
  assert.equal(f.allTables(),before,'All successful/refused exports are read only.');
  await fails(f.exports.get(f.select(orders[1])),'conflict','Canceled records remain ineligible for single-draft export.');
  for(const query of ['companyId=a&offset=0','companyId=a&page=2','companyId=a&q=x&q=y','companyId=a&snapshot=x','companyId=a&status=sent','companyId=a&expected=bad']){
    assert.throws(()=>core.purchaseOrderHistoryExportQuery(new URLSearchParams(query)),e=>e.code==='invalid_request');
  }
  f.state.beforeHistoryRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
  await fails(f.history.get({companyId:'a'}),'forbidden');
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.state.beforeHistoryRead=()=>f.drafts.edit(f.edit(orders[2]));
  await fails(f.history.get({companyId:'a',expected:snapshot.fingerprint}),'changed');
  const filtered=await f.history.get({companyId:'a',filters:{supplier:'literal'}});
  await f.drafts.create(f.create());assert.equal((await f.history.get({companyId:'a',filters:filtered.filters,expected:filtered.fingerprint})).orderCount,1);
  await f.drafts.create(f.create({supplier:{...f.supplier,id:'literal',name:'Literal second'}}));
  await fails(f.history.get({companyId:'a',filters:filtered.filters,expected:filtered.fingerprint}),'changed');
  for(const mutate of [s=>{s.records.pop();},s=>{s.records[0].draft.notes='tampered';},s=>{s.records[0].draft.companyId='b';},
    s=>{s.records[0]=s.records[1];},s=>{s.filters={q:'not-matching',supplier:''};},s=>{s.records.reverse();},s=>{s.limitations=[];}]){
    const bad=structuredClone(snapshot);mutate(bad);await fails(core.verifyPurchaseOrderHistoryExport(bad),'source_invalid');
  }
}finally{f.sql.close();}

// Exact boundaries use real immutable revisions; oversized SQL results contain metadata only.
for(const mode of ['orders','lines','bytes']){
  const f=await historyFixture();
  try{
    let extra={};
    if(mode==='bytes'){
      const registry=new core.D1PurchasingSuppliers(f.db,{identity:async()=>f.state.user,clock:f.options.clock});
      await registry.saveProfile({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Fictional byte limit fixture',supplierId:'large',expectedVersion:0,
        profile:{name:'Large fictional saved registry',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'PRIVATE_PROFILE',
          emailAcceptance:{status:'unknown',note:''},accounts:[{id:'account',reference:'Account',status:'active'}],
          locations:Array.from({length:50},(_,n)=>({id:'location-'+n,accountId:'account',reference:'Location '+n,address:'é'.repeat(1000),status:'active'}))}});
      extra={source:'registry',supplier:undefined,supplierRef:{id:'large',version:1,accountId:'account',locationId:'location-0'}};
    }
    const n=mode==='orders'?100:mode==='lines'?20:10;
    if(mode==='lines')extra.lines=Array.from({length:50},(_,i)=>({...f.nonStock,sku:'LINE-'+i}));
    for(let i=0;i<n;i++)await f.drafts.create(f.create(extra));
    const valid=await f.history.get({companyId:'a'});assert.equal(valid.orderCount,n);
    if(mode==='lines')assert.equal(valid.lineCount,1000);
    if(mode==='bytes')assert.ok(!JSON.stringify(valid).includes('PRIVATE_PROFILE'));
    await f.drafts.create(f.create(extra));
    if(mode==='bytes'){
      while(f.sql.prepare('SELECT sum(length(CAST(snapshot_json AS BLOB))) AS bytes FROM purchase_order_draft_revisions').get().bytes<=core.HISTORY_EXPORT_MAX_BYTES){await f.drafts.create(f.create(extra));}
    }
    const before=f.allTables();await fails(f.history.get({companyId:'a'}),'too_large');assert.equal(f.allTables(),before);
    assert.equal(f.state.lastHistoryRows.length,1);assert.equal(f.state.lastHistoryRows[0].snapshot_json,null);
  }finally{f.sql.close();}
}
console.log('PASS: complete atomic history, current/reviewed/canceled status, tenant/role races, exact filters/fingerprints, immutable capture, all three size boundaries and metadata-only over-limit refusal with zero export writes.');
