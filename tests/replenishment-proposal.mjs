import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/replenishment-proposal.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-proposal.mjs'});
const {buildReviewProposal,REPLENISHMENT_PROPOSAL_CONTRACT}=await import('../.sites-runtime/replenishment-proposal.mjs');
const q=minor=>({dimension:'count',minor:String(minor)});
const input={
  companyId:'fictional-company',productId:'beans',inventoryVersion:4,inventoryConfigId:'config-2',inventoryConfigVersion:2,
  settingsChangeId:'settings-3',settingsVersion:3,settingsChangedBy:'fictional-manager',calculatedAt:'2026-09-25T12:00:00.000Z',
  lastCountAt:'2026-09-24T12:00:00.000Z',countEveryDays:7,expiresAt:null,expiryStatus:'checked',
  salesReadiness:{source:'fictional_fixture',status:'current',heldEventCount:0},
  supplier:{source:'fictional_fixture',supplierId:'fictional-supplier',accountId:'account-1',locationId:'stockroom',sku:'BEANS-CASE'},
  quantities:{target:q(100),onHand:q(20),incoming:q(10),pack:q(30),capacity:null,shelfLimit:null},
  policy:{minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:null},
};
const make=change=>buildReviewProposal({...input,...change});
const baseline=make({});
assert.equal(baseline.contract,REPLENISHMENT_PROPOSAL_CONTRACT);
assert.equal(baseline.mode,'review_only');
assert.equal(baseline.inventoryConfigId,'config-2');
assert.equal(baseline.settingsChangeId,'settings-3');
assert.equal(baseline.salesReadiness.source,'fictional_fixture');
assert.equal(baseline.supplier.source,'fictional_fixture');
assert.deepEqual(baseline.explanation,{position:q(30),shortfall:q(70),wantedPacks:'3',capacityPacks:null,shelfLifePacks:null,maximumPacks:null,recommendedPacks:'3',limitedBy:[],reviewReasons:[]});
assert.equal(make({quantities:{...input.quantities,incoming:q(80)}}).explanation.recommendedPacks,'0');
assert.equal(make({quantities:{...input.quantities,target:q(0)}}).explanation.wantedPacks,'0');
assert.equal(make({quantities:{target:q('9007199254740993'),onHand:q(0),incoming:q(0),pack:q(1),capacity:null,shelfLimit:null}}).explanation.recommendedPacks,'9007199254740993');
const mass=minor=>({dimension:'mass',minor:String(minor)});
const fractional=make({quantities:{target:mass(1500000),onHand:mass(250000),incoming:mass(250000),pack:mass(400000),capacity:mass(1700000),shelfLimit:null}}).explanation;
assert.equal(fractional.shortfall.minor,'1000000');
assert.equal(fractional.recommendedPacks,'3');
const capped=make({quantities:{...input.quantities,capacity:q(100)}}).explanation;
assert.equal(capped.recommendedPacks,'2');
assert.deepEqual(capped.limitedBy,['capacity']);
assert.equal(capped.capacityPacks,'2');
const shelf=make({quantities:{...input.quantities,shelfLimit:q(60)}}).explanation;
assert.equal(shelf.recommendedPacks,'1');
assert.deepEqual(shelf.limitedBy,['shelf_life']);
assert.equal(make({policy:{...input.policy,maximumPacks:'2'}}).explanation.recommendedPacks,'2');
assert.deepEqual(make({policy:{...input.policy,maximumPacks:'2'}}).explanation.limitedBy,['maximum_packs']);
assert.equal(make({policy:{minimumPacks:'4',orderMultiplePacks:'2',maximumPacks:null}}).explanation.recommendedPacks,'4');
const minConflict=make({policy:{minimumPacks:'4',orderMultiplePacks:'1',maximumPacks:'3'}}).explanation;
assert.equal(minConflict.recommendedPacks,'0');
assert.deepEqual(minConflict.reviewReasons,['minimum_exceeds_limit']);
const multipleConflict=make({policy:{minimumPacks:'0',orderMultiplePacks:'2',maximumPacks:'3'}}).explanation;
assert.equal(multipleConflict.recommendedPacks,'0');
assert.ok(multipleConflict.reviewReasons.includes('order_multiple_exceeds_limit'));
const stale=make({lastCountAt:'2026-09-01T12:00:00.000Z'}).explanation;
assert.equal(stale.recommendedPacks,'3');
assert.ok(stale.reviewReasons.includes('stale_count'));
const missing=make({lastCountAt:null}).explanation;
assert.equal(missing.recommendedPacks,'0');
assert.ok(missing.reviewReasons.includes('opening_count_required'));
assert.equal(make({expiresAt:'2026-09-24T12:00:00.000Z'}).explanation.recommendedPacks,'0');
assert.deepEqual(make({expiryStatus:'not_checked'}).explanation.reviewReasons,['expiry_not_checked']);
assert.throws(()=>make({expiryStatus:'not_checked',expiresAt:'2026-09-24T12:00:00.000Z'}),/Unchecked expiry/);
const degraded=make({salesReadiness:{...input.salesReadiness,status:'degraded',heldEventCount:2}}).explanation;
assert.deepEqual(degraded.reviewReasons,['sales_not_current','held_sales_events']);
assert.equal(degraded.recommendedPacks,'3','Unhealthy sales still show review arithmetic; the snapshot is never executable.');
assert.throws(()=>make({inventoryVersion:0}),/versions/);
assert.throws(()=>make({quantities:{...input.quantities,onHand:{dimension:'mass',minor:'20'}}}),error=>error.code==='unit_incompatible');
assert.throws(()=>make({policy:{...input.policy,orderMultiplePacks:'0'}}),/Pack limits/);
assert.throws(()=>make({salesReadiness:{...input.salesReadiness,heldEventCount:-1}}),/Sales readiness/);

const mutable=structuredClone(input);
const frozen=buildReviewProposal(mutable);
mutable.quantities.onHand.minor='90';
mutable.supplier.sku='OTHER';
assert.equal(frozen.quantities.onHand.minor,'20');
assert.equal(frozen.supplier.sku,'BEANS-CASE');
assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.quantities.onHand) && Object.isFrozen(frozen.explanation.reviewReasons));
assert.equal(JSON.parse(JSON.stringify(frozen)).explanation.recommendedPacks,'3');
console.log('PASS: A6 review snapshot arithmetic, source versions, safety caps, review reasons, and immutable copies.');
