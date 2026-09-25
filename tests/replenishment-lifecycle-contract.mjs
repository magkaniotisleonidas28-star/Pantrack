import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/replenishment-lifecycle.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-lifecycle-contract.mjs'});
const {buildProposalHandoff,canTransition,prepareProposalPackEdit,proposalInvalidation,retainsUnresolvedQuantity,PROPOSAL_TRANSITIONS,REPLENISHMENT_HANDOFF_CONTRACT}=
  await import('../.sites-runtime/replenishment-lifecycle-contract.mjs');
await build({entryPoints:['src/lib/replenishment-proposal.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-lifecycle-builder.mjs'});
const {buildReviewProposal}=await import('../.sites-runtime/replenishment-lifecycle-builder.mjs');

const q=minor=>({dimension:'count',minor:String(minor)});
const snapshot=buildReviewProposal({
  companyId:'fictional-company',productId:'beans',inventoryVersion:4,inventoryConfigId:'config-2',inventoryConfigVersion:2,
  settingsChangeId:'settings-3',settingsVersion:3,settingsChangedBy:'fictional-manager',calculatedAt:'2026-09-25T12:00:00.000Z',
  lastCountAt:'2026-09-24T12:00:00.000Z',countEveryDays:7,expiresAt:null,expiryStatus:'not_checked',
  salesReadiness:{source:'fictional_fixture',status:'current',heldEventCount:0},
  supplier:{source:'fictional_fixture',mappingId:'mapping-2',mappingVersion:2,supplierId:'fictional-supplier',accountId:'account-1',locationId:'stockroom',sku:'BEANS-CASE'},
  priceEstimate:{source:'fictional_fixture',currency:'USD',perPackMinor:'1250'},
  quantities:{target:q(100),onHand:q(20),incoming:q(10),pack:q(30),capacity:null,shelfLimit:null},
  policy:{minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:null},
});
const origin={companyId:'fictional-company',id:'proposal-1',productId:'beans',snapshot};
const versions={inventoryVersion:4,inventoryConfigId:'config-2',inventoryConfigVersion:2,settingsChangeId:'settings-3',settingsVersion:3};
const actor={companyId:'fictional-company',userId:'fictional-manager',role:'manager'};
assert.deepEqual(proposalInvalidation(origin,versions),[]);
assert.deepEqual(proposalInvalidation(origin,{...versions,inventoryVersion:5}),['inventory_changed']);
assert.deepEqual(proposalInvalidation(origin,{...versions,inventoryConfigId:'config-3',settingsVersion:4}),['inventory_config_changed','settings_changed']);
assert.deepEqual(proposalInvalidation(origin,null),['source_unavailable']);
const edit=prepareProposalPackEdit(origin,versions,actor,'2','Damaged stock counted today');
assert.deepEqual(edit,{companyId:'fictional-company',proposalId:'proposal-1',packs:'2',reason:'Damaged stock counted today',changedBy:'fictional-manager',estimatedLineTotal:{currency:'USD',minor:'2500'}});
assert.ok(Object.isFrozen(edit) && Object.isFrozen(edit.estimatedLineTotal));
assert.throws(()=>prepareProposalPackEdit(origin,versions,{...actor,role:'employee'},'2','Manager note'),/forbidden/);
assert.throws(()=>prepareProposalPackEdit(origin,versions,{...actor,companyId:'another-company'},'2','Manager note'),/forbidden/);
assert.throws(()=>prepareProposalPackEdit(origin,versions,null,'2','Manager note'),/forbidden/);
assert.throws(()=>prepareProposalPackEdit(origin,versions,actor,'2','   '),/reason/);
assert.throws(()=>prepareProposalPackEdit(origin,versions,actor,'02','Manager note'),/canonical/);
assert.throws(()=>prepareProposalPackEdit(origin,{...versions,settingsVersion:4},actor,'2','Manager note'),/sources changed/);
assert.throws(()=>prepareProposalPackEdit(origin,versions,actor,'9007199254740993','Manager note'),/policy bounds/);
const limited={...origin,snapshot:buildReviewProposal({...snapshot,quantities:{...snapshot.quantities,capacity:q(60)}})};
assert.throws(()=>prepareProposalPackEdit(limited,versions,actor,'2','Manager note'),/safety limit/);
const noCount={...origin,snapshot:buildReviewProposal({...snapshot,lastCountAt:null})};
assert.throws(()=>prepareProposalPackEdit(noCount,versions,actor,'1','Manager note'),/opening count/);
assert.equal(canTransition('review_required','approved'),false);
assert.equal(canTransition('draft','approved'),true);
assert.equal(canTransition('unknown','sending'),false);
assert.equal(canTransition('closed','draft'),false);
for(const status of ['draft','review_required','approved','sending','unknown','accepted','partially_received']){
  assert.equal(retainsUnresolvedQuantity(status),true,`${status} must keep its unresolved quantity held`);
}
for(const status of ['rejected','canceled','closed'])assert.equal(retainsUnresolvedQuantity(status),false);
assert.throws(()=>retainsUnresolvedQuantity('invented'),/status/);
assert.deepEqual(Object.keys(PROPOSAL_TRANSITIONS).sort(),[
  'accepted','approved','canceled','closed','draft','partially_received','rejected','review_required','sending','unknown',
]);
const handoff=buildProposalHandoff(origin,'review_required',1,versions);
assert.equal(handoff.contract,REPLENISHMENT_HANDOFF_CONTRACT);
assert.equal(handoff.mode,'review_only');
assert.equal(handoff.supplierSubmissionAllowed,false);
assert.equal(handoff.packs,'3');
assert.deepEqual(handoff.stockUnitsPerPack,q(30));
assert.deepEqual(handoff.estimatedLineTotal,{currency:'USD',minor:'3750'});
assert.deepEqual(handoff.estimatedProposalTotal,{currency:'USD',minor:'3750'});
assert.equal(handoff.deliveryExpectedAt,null);
assert.deepEqual(handoff.limitPacks,{capacity:null,shelfLife:null,maximum:null});
assert.equal(handoff.priceSource,'fictional_fixture');
assert.ok(handoff.warnings.includes('delivery_unconfirmed'));
assert.ok(handoff.warnings.includes('supplier_mapping_unverified'));
assert.deepEqual(handoff.reviewReasons,['expiry_not_checked']);
assert.deepEqual(handoff.invalidationReasons,[]);
assert.ok(Object.isFrozen(handoff) && Object.isFrozen(handoff.supplier) && Object.isFrozen(handoff.reviewReasons));
const editedHandoff=buildProposalHandoff(origin,'review_required',2,versions,edit);
assert.equal(editedHandoff.packs,'2');
assert.deepEqual(editedHandoff.estimatedLineTotal,{currency:'USD',minor:'2500'});
assert.deepEqual(editedHandoff.estimatedProposalTotal,{currency:'USD',minor:'2500'});
assert.equal(editedHandoff.editReason,'Damaged stock counted today');
assert.equal(editedHandoff.editedBy,'fictional-manager');
assert.throws(()=>buildProposalHandoff(origin,'review_required',2,versions,{...edit,companyId:'another-company'}),/another proposal/);
const fakeSupplierConsumer=value=>{
  if(value.contract!==REPLENISHMENT_HANDOFF_CONTRACT || value.mode!=='review_only' ||
    value.supplierSubmissionAllowed!==false || value.supplier.source==='fictional_fixture') return {kind:'held'};
  throw new Error('The A7 fake must never call a supplier.');
};
assert.deepEqual(fakeSupplierConsumer(handoff),{kind:'held'});
assert.deepEqual(fakeSupplierConsumer(buildProposalHandoff(origin,'approved',2,versions)),{kind:'held'});
assert.deepEqual(buildProposalHandoff(origin,'review_required',2,{...versions,inventoryVersion:5}).invalidationReasons,['inventory_changed']);
assert.throws(()=>buildProposalHandoff(origin,'review_required',0,versions),/revision/);
assert.throws(()=>buildProposalHandoff(origin,'invented',1,versions),/status/);
console.log('PASS: A7 state graph, source invalidation, immutable A-to-C handoff, and fake consumer stay review-only.');
