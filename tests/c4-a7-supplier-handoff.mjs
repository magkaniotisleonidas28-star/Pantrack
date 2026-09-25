import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/c4-fake-supplier-consumer.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/c4-a7-supplier-consumer.mjs'});
const {C4FakeSupplierConsumer}=await import('../.sites-runtime/c4-a7-supplier-consumer.mjs');
await build({entryPoints:['src/lib/replenishment-proposal.ts','src/lib/replenishment-lifecycle.ts'],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/c4-a7-producer',outExtension:{'.js':'.mjs'}});
const {buildReviewProposal}=await import('../.sites-runtime/c4-a7-producer/replenishment-proposal.mjs');
const {buildProposalHandoff}=await import('../.sites-runtime/c4-a7-producer/replenishment-lifecycle.mjs');

const q=minor=>({dimension:'count',minor:String(minor)});
const makeOrigin=(companyId='fictional-company')=>{
  const snapshot=buildReviewProposal({
    companyId,productId:'beans',inventoryVersion:4,inventoryConfigId:'config-2',inventoryConfigVersion:2,
    settingsChangeId:'settings-3',settingsVersion:3,settingsChangedBy:'fictional-manager',calculatedAt:'2026-09-25T12:00:00.000Z',
    lastCountAt:'2026-09-24T12:00:00.000Z',countEveryDays:7,expiresAt:null,expiryStatus:'not_checked',
    salesReadiness:{source:'fictional_fixture',status:'current',heldEventCount:0},
    supplier:{source:'fictional_fixture',mappingId:'mapping-2',mappingVersion:2,supplierId:'fictional-supplier',accountId:'account-1',locationId:'stockroom',sku:'BEANS-CASE'},
    priceEstimate:{source:'fictional_fixture',currency:'USD',perPackMinor:'1250'},
    quantities:{target:q(100),onHand:q(20),incoming:q(10),pack:q(30),capacity:q(120),shelfLimit:null},
    policy:{minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'4'},
  });
  return {companyId,id:'proposal-1',productId:'beans',snapshot};
};
const origin=makeOrigin();
const versions={inventoryVersion:4,inventoryConfigId:'config-2',inventoryConfigVersion:2,settingsChangeId:'settings-3',settingsVersion:3};
const handoff=buildProposalHandoff(origin,'review_required',1,versions);
assert.equal(handoff.packs,'3');
assert.deepEqual(handoff.estimatedProposalTotal,{currency:'USD',minor:'3750'});
const consumer=new C4FakeSupplierConsumer();
const oldFetch=globalThis.fetch;
let calls=0;
globalThis.fetch=()=>{calls++;throw new Error('A fake consumer must not contact a supplier.');};
try{
  const first=consumer.consume(handoff,'fictional-company');
  assert.equal(first.kind,'held');
  assert.equal(first.handoff.proposalId,'proposal-1');
  assert.equal(first.handoff.packs,'3');
  assert.deepEqual(first.handoff.estimatedProposalTotal,{currency:'USD',minor:'3750'});
  assert.ok(first.reasons.includes('review_only') && first.reasons.includes('fictional_supplier'));
  assert.ok(first.reasons.includes('delivery_unconfirmed'));
  assert.ok(first.reasons.includes('expiry_not_checked'));
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.handoff) && Object.isFrozen(first.handoff.supplier));
  assert.equal(consumer.consume(JSON.parse(JSON.stringify(handoff)),'fictional-company'),first,'Replay returns the same held result.');
  const reordered=Object.fromEntries(Object.entries(handoff).reverse());
  reordered.supplier=Object.fromEntries(Object.entries(handoff.supplier).reverse());
  assert.equal(consumer.consume(reordered,'fictional-company'),first,'JSON key order does not change the proposal.');
  assert.equal(calls,0);

  const edit={
    companyId:'fictional-company',proposalId:'proposal-1',packs:'2',reason:'Fictional count correction',
    changedBy:'fictional-manager',estimatedLineTotal:{currency:'USD',minor:'2500'},
  };
  const edited=buildProposalHandoff(origin,'review_required',2,versions,edit);
  const second=consumer.consume(edited,'fictional-company');
  assert.equal(second.handoff.packs,'2');
  assert.equal(second.handoff.editReason,'Fictional count correction');
  assert.equal(second.handoff.estimatedProposalTotal.minor,'2500');
  assert.notEqual(second,first);
  assert.equal(consumer.consume(edited,'fictional-company'),second);
  assert.throws(()=>consumer.consume(handoff,'fictional-company'),error=>error.code==='stale_revision');

  const changedSource=buildProposalHandoff(origin,'review_required',3,{...versions,inventoryVersion:5},edit);
  const heldChanged=consumer.consume(changedSource,'fictional-company');
  assert.ok(heldChanged.reasons.includes('inventory_changed'));
  assert.equal(heldChanged.handoff.supplierSubmissionAllowed,false);
  assert.equal(calls,0);

  const rejects=(value,company,code)=>assert.throws(()=>consumer.consume(value,company),error=>error.code===code);
  rejects(null,'fictional-company','invalid_handoff');
  rejects(handoff,'another-company','forbidden');
  rejects(handoff,'','forbidden');
  rejects({...changedSource,mode:'submit'},'fictional-company','invalid_handoff');
  rejects({...changedSource,supplierSubmissionAllowed:true},'fictional-company','invalid_handoff');
  rejects({...changedSource,supplier:{...changedSource.supplier,source:'real'}},'fictional-company','invalid_handoff');
  rejects({...changedSource,estimatedProposalTotal:{currency:'USD',minor:'999'}},'fictional-company','invalid_handoff');
  rejects({...changedSource,packs:'999'},'fictional-company','invalid_handoff');
  rejects({...changedSource,warnings:['delivery_unconfirmed']},'fictional-company','invalid_handoff');
  rejects({...changedSource,customerEmail:'must not be copied'},'fictional-company','invalid_handoff');
  rejects({...changedSource,supplier:{...changedSource.supplier,secret:'must not be copied'}},'fictional-company','invalid_handoff');
  rejects({...changedSource,revision:3,editReason:'Different manager note',editedBy:'fictional-manager'},'fictional-company','revision_conflict');
  rejects({...changedSource,revision:4,supplier:{...changedSource.supplier,sku:'OTHER-CASE'}},'fictional-company','origin_changed');
  rejects({...changedSource,revision:4,limitPacks:{...changedSource.limitPacks,maximum:'5'}},'fictional-company','origin_changed');
  assert.equal(calls,0);

  const other=buildProposalHandoff(makeOrigin('another-company'),'review_required',1,versions);
  const mutableOther=JSON.parse(JSON.stringify(other));
  const heldOther=consumer.consume(mutableOther,'another-company');
  mutableOther.supplier.sku='TAMPERED';
  assert.equal(heldOther.handoff.companyId,'another-company');
  assert.equal(heldOther.handoff.supplier.sku,'BEANS-CASE','The fake owns an immutable copy.');
  assert.equal(calls,0);
}finally{globalThis.fetch=oldFetch;}
console.log('PASS: C4 fake consumer validates A7 handoffs, isolates companies, holds fictional/edited/stale proposals, rejects replay conflicts, and makes zero supplier calls.');
