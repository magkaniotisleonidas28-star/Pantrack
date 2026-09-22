import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({
  entryPoints:['src/lib/sales-ingestion.ts'],
  bundle:true,
  platform:'node',
  format:'esm',
  outfile:'.sites-runtime/sales-ingestion-contract.mjs',
});
await build({
  entryPoints:['src/lib/inventory-consumption-fake.ts'],
  bundle:true,
  platform:'node',
  format:'esm',
  outfile:'.sites-runtime/sales-ingestion-inventory-fake.mjs',
});

const {
  FakeSalesMappingPort,
  InMemorySalesEventStore,
  SalesIngestionError,
  SalesIngestionService,
}=await import('../.sites-runtime/sales-ingestion-contract.mjs');
const {FakeInventoryConsumptionPort}=await import('../.sites-runtime/sales-ingestion-inventory-fake.mjs');

const contract='pantrack.sales.v1';
const inventoryContract='pantrack.inventory-consumption.v1';
const source={kind:'native',provider:'test-pos',environment:'sandbox',connectionId:'connection-a',merchantId:'merchant-a',locationId:'location-a'};
const manualSource={kind:'manual',provider:'pantrack',environment:'internal',connectionId:'legacy-manual',merchantId:'company-a',locationId:'default'};
const owner={kind:'user',userId:'owner-a',companyId:'company-a',role:'owner'};
const manager={kind:'user',userId:'manager-a',companyId:'company-a',role:'manager'};
const employee={kind:'user',userId:'employee-a',companyId:'company-a',role:'employee'};
const outsider={kind:'user',userId:'owner-b',companyId:'company-b',role:'owner'};
const machine={kind:'machine',machineId:'machine-a',companyId:'company-a',source};
const count=minor=>({dimension:'count',minor:String(minor)});
const volume=minor=>({dimension:'volume',minor:String(minor)});

function inventoryFixture(){
 return {
  now:'2026-03-01T00:00:00Z',
  balances:[
   {companyId:'company-a',productId:'milk',dimension:'volume',onHandMinor:'200000000',version:1,classified:true,openingCountAt:'2026-01-01T00:00:00Z'},
   {companyId:'company-a',productId:'cup',dimension:'count',onHandMinor:'100',version:1,classified:true,openingCountAt:'2026-01-01T00:00:00Z'},
   {companyId:'company-a',productId:'uncounted',dimension:'volume',onHandMinor:'10000000',version:1,classified:true,openingCountAt:null},
   {companyId:'company-a',productId:'unclassified',dimension:'volume',onHandMinor:'10000000',version:1,classified:false,openingCountAt:'2026-01-01T00:00:00Z'},
  ],
  recipes:[
   {companyId:'company-a',recipeId:'latte',versionId:'latte-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'milk',quantity:volume(10000000)},{productId:'cup',quantity:count(1)}]},
   {companyId:'company-a',recipeId:'uncounted-drink',versionId:'uncounted-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'uncounted',quantity:volume(1000)}]},
   {companyId:'company-a',recipeId:'unclassified-drink',versionId:'unclassified-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'unclassified',quantity:volume(1000)}]},
   {companyId:'company-a',recipeId:'missing-stock',versionId:'missing-stock-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'missing',quantity:volume(1000)}]},
   {companyId:'company-a',recipeId:'wrong-unit',versionId:'wrong-unit-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,ingredients:[{productId:'milk',quantity:count(1)}]},
  ],
  modifiers:[
   {companyId:'company-a',recipeId:'latte',modifierId:'extra-shot',versionId:'shot-v1',status:'active',activeFrom:'2026-01-01T00:00:00Z',activeTo:null,deltas:[{productId:'milk',quantity:volume(1000000)}]},
  ],
 };
}

function baseDraft(overrides={}){
 return {
  schemaVersion:contract,
  externalEventId:'event-1',
  externalOrderId:'order-1',
  revision:1,
  eventType:'sale',
  orderStatus:'completed',
  preparationStatus:'prepared',
  occurredAt:'2026-02-15T12:00:00-05:00',
  timeQuality:'provider',
  lines:[{externalLineId:'line-1',externalItemId:'latte-item',externalVariationId:'large',quantity:'1',modifiers:[]}],
  ...overrides,
 };
}

const nativeContext=(overrides={})=>({companyId:'company-a',source,actor:machine,...overrides});
const manualContext=(overrides={})=>({companyId:'company-a',source:manualSource,actor:owner,...overrides});
const mappingFixture=()=>new FakeSalesMappingPort([
 {companyId:'company-a',provider:'test-pos',externalItemId:'latte-item',externalVariationId:'large',recipeId:'latte'},
 {companyId:'company-a',provider:'test-pos',externalItemId:'latte-item',recipeId:'latte'},
 {companyId:'company-a',provider:'test-pos',externalItemId:'uncounted-item',recipeId:'uncounted-drink'},
 {companyId:'company-a',provider:'test-pos',externalItemId:'unclassified-item',recipeId:'unclassified-drink'},
 {companyId:'company-a',provider:'test-pos',externalItemId:'missing-stock-item',recipeId:'missing-stock'},
 {companyId:'company-a',provider:'test-pos',externalItemId:'wrong-unit-item',recipeId:'wrong-unit'},
], [
 {companyId:'company-a',provider:'test-pos',externalItemId:'latte-item',externalVariationId:'large',recipeId:'latte',externalModifierId:'shot-item',modifierId:'extra-shot'},
 {companyId:'company-a',provider:'test-pos',externalItemId:'latte-item',externalVariationId:'large',recipeId:'latte',externalModifierId:'missing-version-item',modifierId:'missing-version'},
]);

function harness(options={}){
 let now=options.now??Date.parse('2026-03-01T00:00:00Z'),sequence=0;
 const clock={now:()=>new Date(now)};
 const idFactory=()=>`id-${++sequence}`;
 const store=options.store??new InMemorySalesEventStore(undefined,idFactory);
 const mappings=options.mappings??mappingFixture();
 const inventory=options.inventory??new FakeInventoryConsumptionPort(inventoryFixture());
 const service=new SalesIngestionService(store,mappings,inventory,{clock,idFactory,afterInventoryApply:options.afterInventoryApply});
 return {store,mappings,inventory,service,setNow:value=>{now=Date.parse(value)}};
}

function thrownCode(fn,code){
 return assert.rejects(fn,error=>error instanceof SalesIngestionError&&error.code===code);
}
const lastAttempt=store=>store.snapshot().attempts.at(-1);

// Receipt normalization, hashing, retention, redaction, duplicates, and conflicts.
{
 const h=harness();
 const pii={customer:{name:'Private Person',email:'private@example.test',phone:'555-0100',address:'secret'},payment:{card:'4111111111111111',tender:'cash'},headers:{authorization:'Bearer secret',cookie:'session=secret'},token:'secret-token',notes:'private note'};
 const draft=baseDraft({sourcePayload:{...pii,lines:[{...baseDraft().lines[0]}]}});
 const receipt=await h.service.receive(nativeContext(),draft);
 assert.equal(receipt.kind,'created');assert.equal(receipt.state,'received');
 const snapshot=h.store.snapshot(),record=snapshot.events[0];
 assert.match(receipt.eventKey,/^[a-f0-9]{64}$/);assert.match(record.applicationKey,/^[a-f0-9]{64}$/);assert.notEqual(record.applicationKey,receipt.eventKey);
 assert.equal(record.event.occurredAt,'2026-02-15T17:00:00.000Z');
 assert.equal(Date.parse(record.event.integrity.payloadExpiresAt)-Date.parse(record.event.receivedAt),30*24*60*60*1000);
 const retained=JSON.stringify(snapshot);
 for(const secret of ['Private Person','private@example.test','555-0100','4111111111111111','Bearer secret','session=secret','secret-token','private note'])assert.ok(!retained.includes(secret),secret);
 assert.ok(retained.includes('latte-item'));assert.ok(retained.includes('line-1'));

 const duplicate=await h.service.receive(nativeContext(),draft);
 assert.equal(duplicate.kind,'duplicate');assert.equal(h.store.snapshot().events.length,1);assert.equal(h.store.snapshot().attempts.length,0);
 const conflict=await h.service.receive(nativeContext(),baseDraft({sourcePayload:{changed:true}}));
 assert.equal(conflict.kind,'conflict');assert.equal(h.store.snapshot().conflicts.length,1);assert.equal(h.store.snapshot().events.length,1);
 const orderConflict=await h.service.receive(nativeContext(),baseDraft({externalEventId:'different-event',sourcePayload:{different:true}}));
 assert.equal(orderConflict.kind,'conflict');assert.equal(h.store.snapshot().conflicts.length,2);
}

// Conflict receipts remain immutable and require an audited owner/manager dismissal.
{
 const h=harness();
 await h.service.receive(nativeContext(),baseDraft());
 const conflict=await h.service.receive(nativeContext(),baseDraft({sourcePayload:{changed:true}}));
 assert.equal(conflict.kind,'conflict');
 for(const actor of [null,employee,outsider,machine])await assert.rejects(()=>h.service.dismissConflict('company-a',conflict.conflictId,actor,'Reviewed mismatch'),error=>['unauthenticated','forbidden_role','wrong_company'].includes(error.code));
 await assert.rejects(()=>h.service.dismissConflict('company-a',conflict.conflictId,owner,'  '),error=>error.code==='reason_required');
 assert.equal(h.store.snapshot().conflictResolutions.length,0);
 const resolution=await h.service.dismissConflict('company-a',conflict.conflictId,manager,'Provider sent a corrupt revision');
 assert.equal(resolution.kind,'dismiss');assert.equal(resolution.conflictId,conflict.conflictId);
 const snapshot=h.store.snapshot();assert.equal(snapshot.conflicts.length,1);assert.equal(snapshot.conflictResolutions.length,1);
 assert.ok(snapshot.audits.some(audit=>audit.action==='conflict_dismissed'&&audit.conflictId===conflict.conflictId&&audit.reason==='Provider sent a corrupt revision'));
 const reloaded=new InMemorySalesEventStore(snapshot);assert.equal((await reloaded.conflict('company-a',conflict.conflictId)).reason,'identity_conflict');assert.equal(reloaded.snapshot().conflictResolutions.length,1);
 await assert.rejects(()=>h.service.dismissConflict('company-a',conflict.conflictId,owner,'Second review'),error=>error.code==='invalid_state');
}

{
 const h=harness();
 const first=baseDraft({lines:[
  {externalLineId:'line-b',externalItemId:'latte-item',quantity:'1',modifiers:[]},
  {externalLineId:'line-a',externalItemId:'latte-item',quantity:'1',modifiers:[{externalModifierLineId:'mod-b',externalModifierId:'shot-item',quantity:'1'},{externalModifierLineId:'mod-a',externalModifierId:'shot-item',quantity:'1'}]},
 ]});
 const second={...first,lines:[first.lines[1],first.lines[0]]};second.lines[0]={...second.lines[0],modifiers:[...second.lines[0].modifiers].reverse()};
 const [created,duplicate]=await Promise.all([h.service.receive(nativeContext(),first),h.service.receive(nativeContext(),second)]);
 assert.deepEqual([created.kind,duplicate.kind].sort(),['created','duplicate']);
 assert.equal(h.store.snapshot().events.length,1);
}

// Rejection before storage for validation, byte limits, and every receipt authorization boundary.
{
 const invalid=[
  [baseDraft({schemaVersion:'pantrack.sales.v0'}),'invalid_schema'],
  [baseDraft({revision:1.5}),'invalid_revision'],
  [baseDraft({occurredAt:'2026-02-30T00:00:00Z'}),'invalid_occurrence_time'],
  [baseDraft({lines:[{...baseDraft().lines[0],quantity:'1.5'}]}),'invalid_quantity'],
  [baseDraft({lines:[baseDraft().lines[0],baseDraft().lines[0]]}),'invalid_line'],
  [baseDraft({lines:[{...baseDraft().lines[0],modifiers:[{externalModifierLineId:'same',externalModifierId:'shot-item',quantity:'1'},{externalModifierLineId:'same',externalModifierId:'shot-item',quantity:'1'}]}]}),'invalid_modifier'],
 ];
 for(const [draft,code] of invalid){const h=harness();await thrownCode(()=>h.service.receive(nativeContext(),draft),code);assert.equal(h.store.snapshot().events.length,0);}
 const oversized=harness();await thrownCode(()=>oversized.service.receive(nativeContext({sourceByteLimit:30}),baseDraft({sourcePayload:{padding:'é'.repeat(30)}})),'payload_too_large');assert.equal(oversized.store.snapshot().events.length,0);
 const retained=harness(),largeLines=Array.from({length:100},(_,lineIndex)=>({externalLineId:`line-${lineIndex}`,externalItemId:`item-${lineIndex}`.padEnd(190,'i'),quantity:'1',modifiers:Array.from({length:10},(_,modifierIndex)=>({externalModifierLineId:`modifier-line-${modifierIndex}`.padEnd(190,String(modifierIndex%10)),externalModifierId:`modifier-${modifierIndex}`.padEnd(190,'m'),quantity:'1'}))}));
 await thrownCode(()=>retained.service.receive(nativeContext({sourceByteLimit:10_000_000}),baseDraft({lines:largeLines})),'retained_fragment_too_large');assert.equal(retained.store.snapshot().events.length,0);
 const authCases=[
  [nativeContext({actor:null}),'unauthenticated'],
  [nativeContext({actor:{...machine,companyId:'company-b'}}),'wrong_company'],
  [nativeContext({actor:{...machine,source:{...source,connectionId:'other'}}}),'source_mismatch'],
  [manualContext({actor:employee}),'forbidden_role'],
  [nativeContext({actor:owner}),'source_mismatch'],
 ];
 for(const [context,code] of authCases){const h=harness();await thrownCode(()=>h.service.receive(context,baseDraft()),code);assert.equal(h.store.snapshot().events.length,0);}
}

// Normal application sends only mapped A2 fields and preserves selected versions and changes.
{
 const h=harness();
 const {eventKey}=await h.service.receive(nativeContext(),baseDraft({lines:[{...baseDraft().lines[0],quantity:'2',modifiers:[{externalModifierLineId:'modifier-1',externalModifierId:'shot-item',quantity:'2'}]}]}));
 const result=await h.service.process('company-a',eventKey);
 assert.equal(result.state,'applied');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'178000000');
 const attempt=lastAttempt(h.store);assert.equal(attempt.outcome,'applied');assert.equal(attempt.inventoryResult.replayed,false);
 assert.equal(attempt.inventoryResult.selectedVersions[0].recipeVersionId,'latte-v1');assert.equal(attempt.inventoryResult.selectedVersions[0].modifiers[0].modifierVersionId,'shot-v1');
 assert.deepEqual(attempt.inventoryResult.changes.map(change=>change.productId),['cup','milk']);
}

// Mapping holds and A2 business holds are whole-event and do not partially apply.
{
 const cases=[
  ['unknown-item',baseDraft({externalEventId:'unknown-item',externalOrderId:'unknown-item',lines:[{...baseDraft().lines[0],externalItemId:'unknown'}]}),'unknown_item'],
  ['unknown-variation',baseDraft({externalEventId:'unknown-var',externalOrderId:'unknown-var',lines:[{...baseDraft().lines[0],externalVariationId:'missing'}]}),'unknown_variation'],
  ['unknown-modifier',baseDraft({externalEventId:'unknown-mod',externalOrderId:'unknown-mod',lines:[{...baseDraft().lines[0],modifiers:[{externalModifierLineId:'mod-1',externalModifierId:'unknown',quantity:'1'}]}]}),'unknown_modifier'],
  ['recipe-version',baseDraft({externalEventId:'recipe',externalOrderId:'recipe',lines:[{...baseDraft().lines[0],externalItemId:'no-version',externalVariationId:undefined}]}),'recipe_version_not_found'],
  ['modifier-version',baseDraft({externalEventId:'modifier',externalOrderId:'modifier',lines:[{...baseDraft().lines[0],modifiers:[{externalModifierLineId:'mod-1',externalModifierId:'missing-version-item',quantity:'1'}]}]}),'modifier_version_not_found'],
  ['inventory',baseDraft({externalEventId:'inventory',externalOrderId:'inventory',lines:[{...baseDraft().lines[0],externalItemId:'missing-stock-item',externalVariationId:undefined}]}),'inventory_not_configured'],
  ['unit-unclassified',baseDraft({externalEventId:'unclassified',externalOrderId:'unclassified',lines:[{...baseDraft().lines[0],externalItemId:'unclassified-item',externalVariationId:undefined}]}),'unit_unclassified'],
  ['unit-incompatible',baseDraft({externalEventId:'unit',externalOrderId:'unit',lines:[{...baseDraft().lines[0],externalItemId:'wrong-unit-item',externalVariationId:undefined}]}),'unit_incompatible'],
  ['opening',baseDraft({externalEventId:'opening',externalOrderId:'opening',lines:[{...baseDraft().lines[0],externalItemId:'uncounted-item',externalVariationId:undefined}]}),'opening_count_required'],
  ['cutoff',baseDraft({externalEventId:'cutoff',externalOrderId:'cutoff',occurredAt:'2026-01-01T00:00:00Z'}),'before_count_cutoff'],
 ];
 for(const [name,draft,code] of cases){
  const mappings=mappingFixture();if(name==='recipe-version')mappings.setLine({companyId:'company-a',provider:'test-pos',externalItemId:'no-version',recipeId:'no-version'});
  const h=harness({mappings}),before=h.inventory.getBalance('company-a','milk');
  const {eventKey}=await h.service.receive(nativeContext(),draft);await h.service.process('company-a',eventKey);
  assert.equal(await h.store.state('company-a',eventKey),'held',name);assert.ok(lastAttempt(h.store).heldReasons.includes(code),name);assert.deepEqual(h.inventory.getBalance('company-a','milk'),before,name);
 }
}

// Preparation, cancellation/refund, inferred time, and complete-revision delta policy.
{
 const noops=[
  baseDraft({externalEventId:'cancel-before',externalOrderId:'cancel-before',eventType:'cancellation',orderStatus:'canceled',preparationStatus:'not_started'}),
  baseDraft({externalEventId:'refund-first',externalOrderId:'refund-first',eventType:'refund',orderStatus:'refunded',preparationStatus:'unknown'}),
 ];
 for(const draft of noops){const h=harness();const before=h.inventory.getBalance('company-a','milk');const {eventKey}=await h.service.receive(nativeContext(),draft);await h.service.process('company-a',eventKey);assert.equal(await h.store.state('company-a',eventKey),'applied');assert.equal(lastAttempt(h.store).outcome,'noop');assert.deepEqual(h.inventory.getBalance('company-a','milk'),before);}
 const holds=[
  [baseDraft({externalEventId:'ambiguous',externalOrderId:'ambiguous',preparationStatus:'unknown'}),'ambiguous_preparation'],
  [baseDraft({externalEventId:'inferred',externalOrderId:'inferred',timeQuality:'inferred'}),'ambiguous_occurrence_time'],
  [baseDraft({externalEventId:'remake-unknown',externalOrderId:'remake-unknown',eventType:'remake',preparationStatus:'unknown'}),'ambiguous_preparation'],
 ];
 for(const [draft,reason] of holds){const h=harness();const {eventKey}=await h.service.receive(nativeContext(),draft);await h.service.process('company-a',eventKey);assert.equal(await h.store.state('company-a',eventKey),'held');assert.deepEqual(lastAttempt(h.store).heldReasons,[reason]);}

 const h=harness();
 const first=await h.service.receive(nativeContext(),baseDraft());await h.service.process('company-a',first.eventKey);
 const afterFirst=h.inventory.getBalance('company-a','milk').onHandMinor;
 const unchanged=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-2',revision:2,eventType:'revision'}));await h.service.process('company-a',unchanged.eventKey);assert.equal(lastAttempt(h.store).outcome,'noop');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,afterFirst);
 const positive=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-3',revision:3,eventType:'reopen',lines:[...baseDraft().lines,{externalLineId:'line-2',externalItemId:'latte-item',externalVariationId:'large',quantity:'1',modifiers:[]}]}));await h.service.process('company-a',positive.eventKey);assert.equal(await h.store.state('company-a',positive.eventKey),'applied');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'180000000');
 const mixed=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-4',revision:4,eventType:'revision',lines:[{...baseDraft().lines[0],quantity:'2'}]}));await h.service.process('company-a',mixed.eventKey);assert.equal(await h.store.state('company-a',mixed.eventKey),'held');assert.deepEqual(lastAttempt(h.store).heldReasons,['correction_required']);
 const modifierOnly=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-5',revision:5,eventType:'revision',lines:[...baseDraft().lines,{externalLineId:'line-2',externalItemId:'latte-item',externalVariationId:'large',quantity:'1',modifiers:[{externalModifierLineId:'new-mod',externalModifierId:'shot-item',quantity:'1'}]}]}));await h.service.process('company-a',modifierOnly.eventKey);assert.equal(await h.store.state('company-a',modifierOnly.eventKey),'held');assert.deepEqual(lastAttempt(h.store).heldReasons,['correction_required']);
}
{
 const h=harness();
 const first=await h.service.receive(nativeContext(),baseDraft());await h.service.process('company-a',first.eventKey);const afterFirst=h.inventory.getBalance('company-a','milk').onHandMinor;
 const canceled=await h.service.receive(nativeContext(),baseDraft({externalEventId:'cancel-after',revision:2,eventType:'cancellation',orderStatus:'canceled'}));await h.service.process('company-a',canceled.eventKey);assert.equal(lastAttempt(h.store).outcome,'noop');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,afterFirst);
 const refunded=await h.service.receive(nativeContext(),baseDraft({externalEventId:'refund-after',revision:3,eventType:'refund',orderStatus:'refunded'}));await h.service.process('company-a',refunded.eventKey);assert.equal(lastAttempt(h.store).outcome,'noop');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,afterFirst);
 const remake=await h.service.receive(nativeContext(),baseDraft({externalEventId:'remake',revision:4,eventType:'remake',lines:[...baseDraft().lines,{externalLineId:'remake-line',externalItemId:'latte-item',externalVariationId:'large',quantity:'1',modifiers:[]}]}));await h.service.process('company-a',remake.eventKey);assert.equal(await h.store.state('company-a',remake.eventKey),'applied');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'180000000');
 const firstObservedCancellation=harness();const cancellation=await firstObservedCancellation.service.receive(nativeContext(),baseDraft({externalEventId:'prepared-cancel',externalOrderId:'prepared-cancel',eventType:'cancellation',orderStatus:'canceled'}));await firstObservedCancellation.service.process('company-a',cancellation.eventKey);assert.equal(await firstObservedCancellation.store.state('company-a',cancellation.eventKey),'applied');assert.equal(firstObservedCancellation.inventory.getBalance('company-a','milk').onHandMinor,'190000000');
}
// Applied no-ops do not become consumption snapshots; they preserve the last actually consumed complete revision.
{
 const h=harness();
 const canceled=await h.service.receive(nativeContext(),baseDraft({externalEventId:'cancel-v1',externalOrderId:'noop-lineage',eventType:'cancellation',orderStatus:'canceled',preparationStatus:'not_started'}));await h.service.process('company-a',canceled.eventKey);assert.equal(lastAttempt(h.store).outcome,'noop');
 const reopened=await h.service.receive(nativeContext(),baseDraft({externalEventId:'reopen-v2',externalOrderId:'noop-lineage',revision:2,eventType:'reopen'}));await h.service.process('company-a',reopened.eventKey);assert.equal(lastAttempt(h.store).outcome,'applied');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'190000000');
 const refunded=await h.service.receive(nativeContext(),baseDraft({externalEventId:'refund-v3',externalOrderId:'noop-lineage',revision:3,eventType:'refund',orderStatus:'refunded'}));await h.service.process('company-a',refunded.eventKey);assert.equal(lastAttempt(h.store).outcome,'noop');
 const unchangedReopen=await h.service.receive(nativeContext(),baseDraft({externalEventId:'reopen-v4',externalOrderId:'noop-lineage',revision:4,eventType:'reopen'}));await h.service.process('company-a',unchangedReopen.eventKey);assert.equal(lastAttempt(h.store).outcome,'noop');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'190000000');
 const addition=await h.service.receive(nativeContext(),baseDraft({externalEventId:'reopen-v5',externalOrderId:'noop-lineage',revision:5,eventType:'reopen',lines:[...baseDraft().lines,{externalLineId:'line-2',externalItemId:'latte-item',externalVariationId:'large',quantity:'1',modifiers:[]}]}));await h.service.process('company-a',addition.eventKey);assert.equal(lastAttempt(h.store).outcome,'applied');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'180000000');
}

// Revision ordering, supersession, claim serialization, terminal applied history, and restart snapshot.
{
 const h=harness();
 const one=await h.service.receive(nativeContext(),baseDraft());
 const two=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-2',revision:2}));
 assert.equal(await h.store.state('company-a',one.eventKey),'superseded');assert.equal(await h.store.state('company-a',two.eventKey),'received');
 const stale=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-stale',revision:1,sourcePayload:{stale:true}}));assert.equal(stale.kind,'conflict');
 const reloaded=new InMemorySalesEventStore(h.store.snapshot());assert.equal(await reloaded.state('company-a',one.eventKey),'superseded');assert.equal((await reloaded.event('company-a',two.eventKey)).event.external.revision,2);
}
{
 const h=harness();const high=await h.service.receive(nativeContext(),baseDraft({externalEventId:'high',externalOrderId:'stale-order',revision:3}));const stale=await h.service.receive(nativeContext(),baseDraft({externalEventId:'low',externalOrderId:'stale-order',revision:2}));assert.equal(high.state,'received');assert.equal(stale.kind,'created');assert.equal(stale.state,'superseded');assert.equal(h.store.snapshot().attempts.length,0);
}
{
 const h=harness();const one=await h.service.receive(nativeContext(),baseDraft());
 const manualAttempt={attemptId:'manual-attempt',eventKey:one.eventKey,startedAt:'2026-03-01T00:00:00.000Z',leaseExpiresAt:'2026-03-01T00:05:00.000Z'};
 assert.equal(await h.store.claim('company-a',one.eventKey,manualAttempt,manualAttempt.startedAt),true);
 const two=await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-2',revision:2}));assert.equal(await h.store.state('company-a',one.eventKey),'processing');assert.equal(await h.store.state('company-a',two.eventKey),'received');
 await thrownCode(()=>h.service.process('company-a',two.eventKey),'claim_conflict');assert.equal(h.store.snapshot().attempts.length,1);
}
{
 const h=harness();const one=await h.service.receive(nativeContext(),baseDraft());await h.service.process('company-a',one.eventKey);
 await h.service.receive(nativeContext(),baseDraft({externalEventId:'event-2',revision:2}));assert.equal(await h.store.state('company-a',one.eventKey),'applied');
}

// A2 requires unique mapped modifier IDs with total occurrence counts.
{
 const h=harness();
 const draft=baseDraft({lines:[{...baseDraft().lines[0],quantity:'2',modifiers:[
  {externalModifierLineId:'shot-one',externalModifierId:'shot-item',quantity:'1'},
  {externalModifierLineId:'shot-two',externalModifierId:'shot-item',quantity:'2'},
 ]}]});
 const receipt=await h.service.receive(nativeContext(),draft);
 await h.service.process('company-a',receipt.eventKey);
 assert.equal(await h.store.state('company-a',receipt.eventKey),'applied','Repeated mapped extras must be combined before A2');
 assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'177000000');
 assert.deepEqual(lastAttempt(h.store).inventoryResult.selectedVersions[0].modifiers,[{modifierId:'extra-shot',modifierVersionId:'shot-v1',quantity:'3'}]);
}
{
 const h=harness();
 const draft=baseDraft({lines:[{...baseDraft().lines[0],modifiers:[
  {externalModifierLineId:'first',externalModifierId:'shot-item',quantity:'9007199254740991'},
  {externalModifierLineId:'second',externalModifierId:'shot-item',quantity:'1'},
 ]}]});
 const before=h.inventory.getBalance('company-a','milk');
 const receipt=await h.service.receive(nativeContext(),draft);
 await h.service.process('company-a',receipt.eventKey);
 assert.equal(await h.store.state('company-a',receipt.eventKey),'held');
 assert.ok(lastAttempt(h.store).heldReasons.includes('invalid_quantity'));
 assert.deepEqual(h.inventory.getBalance('company-a','milk'),before);
}

// Never persist an A2 result belonging to a different company, sale, or contract.
{
 for(const field of ['companyId','idempotencyKey','contract','occurredAt']){
  let callbackCalled=false;
  const h=harness({inventory:{consume:async request=>({contract:inventoryContract,companyId:request.companyId,idempotencyKey:request.idempotencyKey,
   status:'applied',replayed:false,occurredAt:request.occurredAt,selectedVersions:[],changes:[],[field]:'foreign-result'})},
   afterInventoryApply:()=>{callbackCalled=true}});
  const receipt=await h.service.receive(nativeContext(),baseDraft());
  await h.service.process('company-a',receipt.eventKey);
  assert.equal(await h.store.state('company-a',receipt.eventKey),'failed',field);
  assert.equal(lastAttempt(h.store).errorCode,'integration_defect');
  assert.equal(lastAttempt(h.store).inventoryResult,undefined);
  assert.equal(callbackCalled,false);
 }
}

// Independent review follow-up: malformed envelopes and foreign non-applied
// replies fail closed without copying their contents into this company's audit.
{
 const cases=[
  ['null',()=>null],
  ['nonboolean-replay',result=>({...result,replayed:'false'})],
  ['unknown-status',result=>({...result,status:'unknown'})],
  ['missing-versions',result=>({...result,selectedVersions:undefined})],
  ['missing-changes',result=>({...result,changes:undefined})],
 ];
 for(const status of ['held','rejected']){
  const issue={code:status==='held'?'unit_unclassified':'invalid_quantity',message:'requires review'};
  for(const field of ['companyId','idempotencyKey','contract']){
   cases.push([`${status}-${field}`,result=>({...result,status,issues:[issue],[field]:'foreign-result'})]);
  }
  cases.push([`${status}-empty-issues`,result=>({...result,status,issues:[]})]);
  cases.push([`${status}-missing-issues`,result=>({...result,status})]);
  cases.push([`${status}-replayed`,result=>({...result,status,issues:[issue],replayed:true})]);
 }
 for(const [name,mutate] of cases){
  let callbackCalled=false;
  const h=harness({inventory:{consume:async request=>mutate({contract:inventoryContract,companyId:request.companyId,
   idempotencyKey:request.idempotencyKey,status:'applied',replayed:false,occurredAt:request.occurredAt,selectedVersions:[],changes:[]})},
   afterInventoryApply:()=>{callbackCalled=true}});
  const receipt=await h.service.receive(nativeContext(),baseDraft());
  await h.service.process('company-a',receipt.eventKey);
  assert.equal(await h.store.state('company-a',receipt.eventKey),'failed',name);
  assert.equal(lastAttempt(h.store).errorCode,'integration_defect',name);
  assert.equal(lastAttempt(h.store).inventoryResult,undefined,name);
  assert.equal(lastAttempt(h.store).issues,undefined,name);
  assert.equal(callbackCalled,false,name);
 }
}

// Exact A2 outcome mapping, retry/replay/dismiss/correction authorization, and sensitive read denial.
{
 const portFor=result=>({consume:async request=>typeof result==='function'?result(request):{...structuredClone(result),idempotencyKey:request.idempotencyKey}});
 const baseResult=(status,issues=[])=>({contract:inventoryContract,companyId:'company-a',idempotencyKey:'ignored',replayed:false,status,issues});
 const cases=[
  ['held',baseResult('held',[{code:'recipe_version_not_found',message:'missing'}]),'held','recipe_version_not_found'],
  ['invalid-quantity',baseResult('rejected',[{code:'invalid_quantity',message:'bad'}]),'held','invalid_quantity'],
  ['identity',baseResult('rejected',[{code:'idempotency_conflict',message:'conflict'}]),'held','identity_conflict'],
  ['defect',baseResult('rejected',[{code:'invalid_contract',message:'bad contract'}]),'failed',null],
 ];
 for(const [name,result,state,reason] of cases){const h=harness({inventory:portFor(result)});const receipt=await h.service.receive(nativeContext(),baseDraft({externalEventId:name,externalOrderId:name}));await h.service.process('company-a',receipt.eventKey);assert.equal(await h.store.state('company-a',receipt.eventKey),state,name);if(reason)assert.ok(lastAttempt(h.store).heldReasons.includes(reason),name);}
 const unavailable=harness({inventory:{consume:async()=>{throw new Error('offline')}}});const failed=await unavailable.service.receive(nativeContext(),baseDraft({externalEventId:'offline',externalOrderId:'offline'}));await unavailable.service.process('company-a',failed.eventKey);assert.equal(await unavailable.store.state('company-a',failed.eventKey),'failed');assert.equal(lastAttempt(unavailable.store).errorCode,'inventory_unavailable');
 await assert.rejects(()=>unavailable.service.retry('company-a',failed.eventKey,employee,'try'),error=>error.code==='forbidden_role');
 await unavailable.service.retry('company-a',failed.eventKey,manager,'Provider restored');assert.equal(await unavailable.store.state('company-a',failed.eventKey),'received');
}
{
 const h=harness();const held=await h.service.receive(nativeContext(),baseDraft({externalEventId:'held',externalOrderId:'held',timeQuality:'inferred'}));await h.service.process('company-a',held.eventKey);
 for(const actor of [null,employee,outsider,machine])await assert.rejects(()=>h.service.replay('company-a',held.eventKey,actor,'repair'),error=>['unauthenticated','forbidden_role','wrong_company'].includes(error.code));
 await assert.rejects(()=>h.service.dismiss('company-a',held.eventKey,owner,'   '),error=>error.code==='reason_required');
 await h.service.replay('company-a',held.eventKey,manager,'Occurrence confirmed');assert.equal(await h.store.state('company-a',held.eventKey),'received');
 // The immutable time-quality fact remains inferred, so replay safely holds again.
 await h.service.process('company-a',held.eventKey);assert.equal(await h.store.state('company-a',held.eventKey),'held');assert.equal(h.store.snapshot().attempts.length,2);
 await h.service.dismiss('company-a',held.eventKey,owner,'Cannot establish occurrence time');assert.equal(await h.store.state('company-a',held.eventKey),'dismissed');

 const applied=await h.service.receive(nativeContext(),baseDraft({externalEventId:'applied',externalOrderId:'applied'}));await h.service.process('company-a',applied.eventKey);
 await assert.rejects(()=>h.service.requestCorrection('company-a',applied.eventKey,employee,'mistake'),error=>error.code==='forbidden_role');
 const before=h.inventory.getBalance('company-a','milk');const correction=await h.service.requestCorrection('company-a',applied.eventKey,manager,'Wrong menu mapping');assert.equal(correction.status,'pending');assert.equal(await h.store.state('company-a',applied.eventKey),'applied');assert.deepEqual(h.inventory.getBalance('company-a','milk'),before);
 assert.deepEqual(await h.service.readStatus('company-a',applied.eventKey,employee),{eventKey:applied.eventKey,companyId:'company-a',state:'applied',eventType:'sale',orderStatus:'completed',preparationStatus:'prepared',occurredAt:'2026-02-15T17:00:00.000Z',receivedAt:'2026-03-01T00:00:00.000Z',revision:1});
 await assert.rejects(()=>h.service.readStatus('company-a',applied.eventKey,outsider),error=>error.code==='wrong_company');await assert.rejects(()=>h.service.readStatus('company-a',applied.eventKey,machine),error=>error.code==='wrong_company');
 assert.ok(!JSON.stringify(await h.service.readStatus('company-a',applied.eventKey,employee)).includes('latte-item'));
}

// Crash after A2 application: lease expiry never assumes success; explicit retry reuses the A2 key and gets replayed.
{
 let crash=true;
 const h=harness({afterInventoryApply:()=>{if(crash)throw new Error('simulated process crash')}});
 const receipt=await h.service.receive(nativeContext(),baseDraft({externalEventId:'crash',externalOrderId:'crash'}));
 await assert.rejects(()=>h.service.process('company-a',receipt.eventKey),/simulated process crash/);assert.equal(await h.store.state('company-a',receipt.eventKey),'processing');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'190000000');
 h.setNow('2026-03-01T00:06:00Z');assert.deepEqual(await h.service.recoverExpiredLeases('company-a'),[receipt.eventKey]);assert.equal(await h.store.state('company-a',receipt.eventKey),'failed');assert.equal(lastAttempt(h.store).errorCode,'interrupted');
 await h.service.retry('company-a',receipt.eventKey,owner,'Worker restarted');crash=false;await h.service.process('company-a',receipt.eventKey);assert.equal(await h.store.state('company-a',receipt.eventKey),'applied');assert.equal(h.inventory.getBalance('company-a','milk').onHandMinor,'190000000');assert.equal(lastAttempt(h.store).inventoryResult.replayed,true);
 const keys=h.store.snapshot().attempts.map(attempt=>attempt.inventoryResult?.idempotencyKey).filter(Boolean);assert.equal(new Set(keys).size,1);
}

console.log('PASS: B2 fake-backed ingestion validates and redacts receipts, preserves atomic identity/history, enforces tenant roles, applies policy and A2 outcomes safely, and recovers crash/retry without duplicate inventory.');
