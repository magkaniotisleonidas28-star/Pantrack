import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';

await build({stdin:{contents:["d1-supplier-suggestions","d1-purchasing-suppliers","d1-purchase-order-drafts","d1-replenishment-settings","d1-replenishment-proposal-origins"]
  .map(n=>`export * from './src/lib/${n}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/supplier-suggestions-tests.mjs'});
const {D1SupplierSuggestions,D1PurchasingSuppliers,D1PurchaseOrderDrafts,D1ReplenishmentSettingsStore,D1ReplenishmentProposalOrigins}=await import('../.sites-runtime/supplier-suggestions-tests.mjs');

// Each fixture item: 20 on hand, 10 incoming, target 100, capacity 120, item pack 30, at most 4 item packs, counted now, Clover sales current.
const f=await fixture();let actor='manager',at='2026-10-01T12:00:00.000Z';
const clock={now:()=>new Date(at)},options={identity:async()=>actor,clock},policy={syncEnabled:true,maxLagMs:600_000};
const items=['milk','beans','cups','sugar','flour','oil','rice','tea'];for(const productId of items)await f.source({productId,clover:true});
const registry=new D1PurchasingSuppliers(f.db,options),suggestions=()=>new D1SupplierSuggestions(f.db,{...options,salesPolicy:policy});
const profile={name:'Fictional Café Supply',email:null,telephone:'',paymentTerms:'Illustrative',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'Fictional only',
  emailAcceptance:{status:'unknown',note:''},accounts:[{id:'account',reference:'A-001',status:'active'},{id:'other-account',reference:'A-002',status:'active'}],
  locations:[{id:'location',accountId:'account',reference:'Café north',address:'123 Fictional Street',status:'active'},
    {id:'other-location',accountId:'other-account',reference:'Café south',address:'456 Fictional Street',status:'active'}]};
const saveProfile=supplierId=>registry.saveProfile({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Fictional supplier setup',supplierId,expectedVersion:0,profile});
const map=(mappingId,productId,packAmount,extra={})=>registry.saveMapping({action:'save_mapping',companyId:'a',operationId:crypto.randomUUID(),reason:'Reviewed pack',mappingId,expectedVersion:0,
  supplierId:'six',expectedSupplierVersion:1,accountId:'account',locationId:'location',productId,expectedConfigId:`config-${productId}`,expectedConfigVersion:1,
  sku:`SKU-${mappingId}`,description:`${productId} (${packAmount})`,unitLabel:'case',packAmount,packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:null,...extra});
await saveProfile('six');await saveProfile('twelve');
await map('milk-6','milk','6',{estimatedUnitMinor:'500'});await map('milk-12','milk','12',{supplierId:'twelve'});
await map('beans-30','beans','30');await map('cups-6','cups','6');await map('sugar-6','sugar','6');await map('flour-6','flour','6');
await map('oil-6','oil','6');await map('oil-12','oil','12');await map('rice-6','rice','6');await map('tea-other','tea','6',{accountId:'other-account',locationId:'other-location'});
const group=(supplierId='six',extra={})=>({companyId:'a',supplierId,accountId:'account',locationId:'location',...extra});
const fail=code=>e=>e.code===code;
const tables=()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]));
const settings=new D1ReplenishmentSettingsStore(f.db,{clock}),q=minor=>({dimension:'count',minor:String(minor)});
async function setSettings(productId,patch){
  const current=await settings.current('a',productId,{companyId:'a',userId:'manager',role:'manager'});
  await settings.save({companyId:'a',productId,changeId:`change-${productId}-${current.version+1}`,expectedVersion:current.version,expectedConfigId:`config-${productId}`,expectedConfigVersion:1,
    actor:{companyId:'a',userId:'manager',role:'manager'},reason:'Fictional change',settings:{...current.settings,...patch}});
}
const balance=(productId,set)=>f.sql.prepare(`UPDATE inventory_balances_exact SET ${set},version=version+1 WHERE company_id='a' AND product_id=?`).run(productId);

// Access: only current owners and managers of the company; the group must be active.
// The suggestion's own role check refuses first, before the supplier list's.
for(const who of [null,'employee','b-manager']){actor=who;await assert.rejects(suggestions().suggest(group()),e=>e.code==='forbidden'&&e.message==='Manager or owner membership is required.');}
actor='manager';
for(const bad of [{companyId:'a'},{...group(),extra:1},{...group(),supplierId:''}])await assert.rejects(suggestions().suggest(bad),fail('invalid_request'));
await assert.rejects(suggestions().suggest(group('unknown')),fail('missing'));
await assert.rejects(suggestions().suggest(group('six',{locationId:'other-location'})),fail('conflict'),'The location belongs to another account');
actor='b-manager';await assert.rejects(suggestions().suggest({...group(),companyId:'b'}),fail('missing'),'Another company cannot see this supplier');actor='manager';

// One profile per pack: the same need (70 units short) becomes 12 packs of 6 here and 6 packs of 12 at the other supplier.
await setSettings('sugar',{minimumPacks:'1'});await setSettings('flour',{orderMultiplePacks:'2'});await setSettings('rice',{target:q(1000),capacity:null,maximumPacks:'1'});
balance('cups',"on_hand_minor='95'");
const before=tables(),six=await suggestions().suggest(group());
assert.equal(tables(),before,'Suggestions are read-only');
assert.deepEqual(six.sales,{status:'current',reasons:[],heldEventCount:0});
const line=id=>six.lines.find(l=>l.mappingId===id);
assert.deepEqual([line('milk-6').packs,line('milk-6').explanation.shortfall,line('milk-6').estimatedLineMinor],['12',q(70),'6000']);
assert.equal((await suggestions().suggest(group('twelve'))).lines[0].packs,'6');
assert.equal(line('beans-30').packs,'3','The item\'s own pack gives the same suggestion as the manual plan');
assert.equal(line('sugar-6').packs,'12','A one-pack minimum (30 units) is 5 packs of 6, below the need');
assert.deepEqual([line('rice-6').packs,line('rice-6').explanation.limitedBy],['5',['maximum_packs']],'At most one item pack (30 units) is at most 5 packs of 6');
assert.deepEqual(six.notNeeded.map(n=>n.mappingId),['cups-6'],'Enough on the shelf and on order');
assert.deepEqual(six.held.map(h=>[h.mappingId,h.reason]).sort(),[['flour-6','pack_policy_unconvertible'],['oil-12','duplicate_product'],['oil-6','duplicate_product']]);
assert.equal(six.lines.some(l=>l.productId==='tea'),false,'Other accounts and locations stay out');
// Small needs meet the converted minimum: 10 units short (2 packs) becomes the 5-pack minimum, within capacity.
balance('sugar',"on_hand_minor='80'");assert.equal((await suggestions().suggest(group())).lines.find(l=>l.mappingId==='sugar-6').packs,'5');

// Uneven packs: one item pack (30) is a minimum of 3 packs of 12 (rounded up) and a maximum of 2 (rounded down).
await map('tea-12','tea','12',{supplierId:'twelve'});await setSettings('tea',{minimumPacks:'1',capacity:null});balance('tea',"on_hand_minor='85'");
assert.equal((await suggestions().suggest(group('twelve'))).lines.find(l=>l.mappingId==='tea-12').packs,'3','5 short, minimum 30 units: 3 packs of 12');
await setSettings('tea',{minimumPacks:'0',target:q(1000),maximumPacks:'1'});
assert.deepEqual((await suggestions().suggest(group('twelve'))).lines.find(l=>l.mappingId==='tea-12').packs,'2','At most 30 units: 2 packs of 12');
// Fresh numbers: stock and deliveries change the next calculation.
balance('milk',"on_hand_minor='80'");assert.equal((await suggestions().suggest(group())).lines.find(l=>l.mappingId==='milk-6').packs,'2','10 short is 2 packs of 6');
balance('milk',"incoming_minor='30'");assert.equal((await suggestions().suggest(group())).notNeeded.some(n=>n.mappingId==='milk-6'),true);
balance('milk',"on_hand_minor='20',incoming_minor='10'");

// Holds and attention: no opening count means nothing is suggested; an overdue count is flagged; stale sales are reported once.
balance('beans','latest_count_effective_at=NULL');
const later=await suggestions().suggest(group());
assert.deepEqual(later.held.find(h=>h.mappingId==='beans-30').reason,'opening_count_required');
at='2026-10-09T12:00:00.000Z';const overdue=await suggestions().suggest(group());
assert.deepEqual(overdue.lines.find(l=>l.mappingId==='milk-6').attention,['stale_count']);
assert.equal(overdue.sales.status==='current',false,'Sales readiness reports the lag; the caller decides');
// A mapping whose custom pack measurement was retired needs review before it can be suggested.
f.sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
  VALUES('a','cups','sleeve',1,'custom','count','sleeve','6','1','manager',?,NULL)`).run(at);
await map('cups-sleeve','cups','1',{supplierId:'twelve',packUnitId:'sleeve'});
f.sql.prepare(`UPDATE product_unit_versions SET retired_at=? WHERE company_id='a' AND product_id='cups' AND unit_id='sleeve'`).run(at);
assert.deepEqual((await suggestions().suggest(group('twelve'))).held.map(h=>[h.mappingId,h.reason]),[['cups-sleeve','mapping_needs_review']]);
at='2026-10-01T12:00:00.000Z';

// Draft-ready: the lines create a supplier-list draft unchanged.
balance('beans',`latest_count_effective_at='${at}'`);
const ready=await suggestions().suggest(group());
const draft=await new D1PurchaseOrderDrafts(f.db,options).create({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'registry',
  supplierRef:{id:'six',version:1,accountId:'account',locationId:'location'},capMinor:'100000',notes:'Fictional',
  lines:ready.lines.map(l=>({kind:'stock',mappingId:l.mappingId,mappingVersion:l.mappingVersion,packs:l.packs}))});
assert.deepEqual(draft.snapshot.lines.map(l=>[l.productId,l.packs,l.stockQuantity.minor]),ready.lines.map(l=>[l.productId,l.packs,String(BigInt(l.packs)*BigInt(l.stockUnitsPerPack.minor))]));

// Supplier-list reviews stay transient: durable proposals refuse them.
const origins=new D1ReplenishmentProposalOrigins(f.db,{clock});
const request={companyId:'a',productId:'milk',id:'p-registry',createId:'c-registry',actor:{companyId:'a',userId:'manager',role:'manager'},priceEstimate:null,
  supplier:{companyId:'a',source:'manual_registry',mappingId:'milk-6',mappingVersion:1,supplierId:'six',accountId:'account',locationId:'location',sku:'SKU-milk-6'}};
await assert.rejects(origins.createWithClover(request,policy),fail('invalid_request'));
await assert.rejects(origins.createWithClover({...request,supplier:{...request.supplier,source:'fictional_fixture'},supplierPack:q(6)},policy),fail('invalid_request'));
console.log('PASS: supplier suggestions recalculate current needs per supplier-list mapping in its own pack (exact minimum/maximum conversion, unconvertible multiples held), hold missing counts and duplicate products, flag overdue counts, report sales readiness, stay read-only and company/role scoped, feed a supplier-list draft unchanged, and never persist as proposals.');
