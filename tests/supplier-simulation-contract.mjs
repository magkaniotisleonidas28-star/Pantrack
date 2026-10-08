import assert from 'node:assert/strict';
import {core,fixture} from './helpers/supplier-simulation.mjs';
const f=await fixture(),h=await f.source();
const source=core.supplierSource([h],'a');
assert.equal(h.packs,'3');
assert.equal(h.stockUnitsPerPack.minor,'30');
assert.ok(Object.isFrozen(source.handoffs[0].supplier));
const quote=f.connector.quote(source,'quote-1',f.options.clock.now());
assert.equal(quote.totalMinor,3250);assert.equal(quote.fees[0].minor,250);
assert.equal(quote.provenance,'simulated');assert.equal(quote.lines[0].lineTotalMinor,3000);
assert.equal(f.connector.capabilities.portal,'unverified');assert.equal(f.connector.capabilities.delivery,'unavailable');
for(const invalid of [
  {...quote,totalMinor:3000},{...quote,currency:'EUR'},{...quote,provenance:'provider_verified'},
  {...quote,fees:[{label:'bad',minor:-1}]},{...quote,extra:'secret'},
  {...quote,lines:[{...quote.lines[0],packs:'1.5'}]},
  {...quote,lines:[{...quote.lines[0],stockUnitsPerPack:{dimension:'count',minor:'60'}}]},
  {...quote,lines:[{...quote.lines[0],revision:99}]},
  {...quote,group:{...quote.group,accountId:'other'}},
  {...quote,expiresAt:quote.quotedAt},
])assert.throws(()=>core.validateSupplierQuote(invalid,source,f.options.clock.now()),e=>e.code==='invalid_request');
for(const invalid of [
  [h,h],[{...h,packs:'0'}],[{...h,packs:'1.5'}],[{...h,companyId:'b'}],
  [{...h,salesReadiness:{source:'fictional_fixture',status:'degraded',heldEventCount:1}}],
  [{...h,status:'unknown'}],[{...h,invalidationReasons:['inventory_changed'],warnings:[...h.warnings,'inventory_changed']}],
  [h,await f.source({accountId:'another-account'})],
  [h,await f.source({locationId:'another-location'})],
])assert.throws(()=>core.supplierSource(invalid,'a'),e=>e.code==='invalid_request');
assert.throws(()=>new core.D1SupplierSimulation(f.db,{...f.options,connector:{submit(){throw Error('Must not run');}}}),e=>e.code==='simulation_only');
assert.throws(()=>new core.D1SupplierSimulation(f.db,{...f.options,connector:{...f.connector}}),e=>e.code==='simulation_only');
// Changing the caller's options after construction cannot switch to a live transport.
const mutable={...f.options},engine=new core.D1SupplierSimulation(f.db,mutable);
mutable.connector={submit(){throw Error('Live transport was invoked');}};
const order=await engine.create({companyId:'a',orderId:'protected',operationId:'protected-create',handoffs:[h]});
await assert.rejects(engine.create({companyId:'a',orderId:'extra-fields',operationId:'extra-fields',handoffs:[h],password:'fictional-do-not-store'}),e=>e.code==='invalid_request');
await assert.rejects(engine.quote({...f.command(order,'role-injection'),role:'owner'}),e=>e.code==='invalid_request');
assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM supplier_simulation_operations WHERE fingerprint LIKE '%fictional-do-not-store%'").get().n,0);
assert.equal((await engine.quote(f.command(order,'protected-quote'))).quote.totalMinor,3250);
assert.equal(f.connector.calls,0);
assert.equal(core.matchingSupplierResult({status:'accepted'},'reference',quote),null);
f.sql.close();
console.log('PASS: exact quote arithmetic, grouping, bounded whole packs, conversions, simulated provenance and transport exclusion.');
