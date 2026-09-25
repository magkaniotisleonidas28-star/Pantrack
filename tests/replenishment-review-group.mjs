import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/replenishment-review-group.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-review-group.mjs'});
const {groupReviewProposals}=await import('../.sites-runtime/replenishment-review-group.mjs');
await build({entryPoints:['src/lib/replenishment-proposal.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/replenishment-review-group-builder.mjs'});
const {buildReviewProposal}=await import('../.sites-runtime/replenishment-review-group-builder.mjs');
const q=minor=>({dimension:'count',minor:String(minor)});
const base={
  companyId:'fictional-a',productId:'beans',inventoryVersion:1,inventoryConfigId:'config-1',inventoryConfigVersion:1,
  settingsChangeId:'settings-1',settingsVersion:1,settingsChangedBy:'manager',calculatedAt:'2026-09-25T12:00:00.000Z',
  lastCountAt:'2026-09-24T12:00:00.000Z',countEveryDays:7,expiresAt:null,expiryStatus:'not_checked',
  salesReadiness:{source:'fictional_fixture',status:'current',heldEventCount:0},
  supplier:{source:'fictional_fixture',mappingId:'map-1',mappingVersion:1,supplierId:'supplier-1',accountId:'account-1',locationId:'kitchen',sku:'CASE'},
  priceEstimate:{source:'fictional_fixture',currency:'USD',perPackMinor:'1250'},
  quantities:{target:q(100),onHand:q(20),incoming:q(10),pack:q(30),capacity:null,shelfLimit:null},
  policy:{minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:null},
};
const make=overrides=>buildReviewProposal({...base,...overrides});
const beans=make({});
const rice=make({productId:'rice',priceEstimate:{...base.priceEstimate,perPackMinor:'9007199254740993'}});
const tea=make({productId:'tea',priceEstimate:{...base.priceEstimate,currency:'EUR',perPackMinor:'200'}});
const milk=make({productId:'milk',priceEstimate:null});
const otherAccount=make({productId:'cups',supplier:{...base.supplier,accountId:'account-2'}});
const otherLocation=make({productId:'lids',supplier:{...base.supplier,locationId:'stockroom'}});
const otherSupplier=make({productId:'sugar',supplier:{...base.supplier,supplierId:'supplier-2'}});
const input=[tea,otherAccount,otherLocation,otherSupplier,milk,beans,rice];
const groups=groupReviewProposals('fictional-a',input);
assert.equal(groups.length,4);
const account1=groups.find(group=>group.accountId==='account-1');
const account2=groups.find(group=>group.accountId==='account-2');
assert.deepEqual(account1.lines.map(line=>line.productId),['beans','milk','rice','tea']);
assert.deepEqual(account1.estimatedTotals,[{currency:'EUR',minor:'600'},{currency:'USD',minor:'27021597764226729'}]);
assert.equal(account1.unpricedLineCount,1);
assert.deepEqual(account1.reviewReasons,['expiry_not_checked','price_not_checked']);
assert.equal(account1.supplierId,'supplier-1');
assert.equal(account1.locationId,'kitchen');
assert.deepEqual(account2.estimatedTotals,[{currency:'USD',minor:'3750'}]);
assert.equal(account2.unpricedLineCount,0);
assert.equal(account2.mode,'review_only');
assert.equal(groups.find(group=>group.locationId==='stockroom').lines[0].productId,'lids');
assert.equal(groups.find(group=>group.supplierId==='supplier-2').lines[0].productId,'sugar');
input.length=0;
assert.equal(account1.lines.length,4,'Grouping must copy the caller array.');
assert.ok(Object.isFrozen(groups) && Object.isFrozen(account1) && Object.isFrozen(account1.lines) && Object.isFrozen(account1.estimatedTotals[0]));
assert.equal(JSON.parse(JSON.stringify(groups))[0].mode,'review_only');
assert.equal(JSON.parse(JSON.stringify(account1)).estimatedTotals[1].minor,'27021597764226729');
assert.deepEqual(groupReviewProposals('fictional-a',[]),[]);
assert.deepEqual(groupReviewProposals('fictional-a',[milk])[0].estimatedTotals,[]);
assert.throws(()=>groupReviewProposals('fictional-a',[beans,beans]),/only once/);
assert.throws(()=>groupReviewProposals('fictional-a',[beans,make({productId:'beans',supplier:{...base.supplier,accountId:'account-2'}})]),/only once/);
assert.throws(()=>groupReviewProposals('fictional-a',[beans,make({companyId:'fictional-b',productId:'other'})]),/one company/);
assert.throws(()=>groupReviewProposals('fictional-a',[{...beans}]),/frozen A6 snapshots/);
assert.throws(()=>groupReviewProposals('fictional-a',[Object.freeze({...beans,supplier:{...beans.supplier}})]),/frozen A6 snapshots/);
console.log('PASS: A6 groups immutable review lines by supplier/account/location, sums exact totals per currency, and rejects duplicate or cross-company lines.');
