import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {fixture,entries} from './helpers/supplier-simulation.mjs';
await build({stdin:{contents:"export * from './src/lib/d1-purchasing-suppliers'; export * from './src/lib/d1-purchase-order-drafts'; export * from './src/lib/d1-inventory-management';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/registry-tests.mjs'});
const {D1PurchasingSuppliers,D1PurchaseOrderDrafts,D1InventoryManagementService}=await import('../.sites-runtime/registry-tests.mjs');
const f=await fixture();await f.source({productId:'milk'});await f.source({companyId:'b',productId:'foreign'});
let actor='manager';const clock={now:()=>new Date('2026-10-04T12:00:00.000Z')},options={identity:async()=>actor,clock};
const registry=new D1PurchasingSuppliers(f.db,options),po=new D1PurchaseOrderDrafts(f.db,options);
const profile={name:'Fictional Café Supply',email:null,telephone:'',paymentTerms:'Net 30, illustrative',minimumOrderMinor:null,deliveryFeeMinor:null,
  orderingInstructions:'Delivery Wednesday; cutoff Tuesday',notes:'Fictional only',emailAcceptance:{status:'unknown',note:''},
  accounts:[{id:'account',reference:'A-001',status:'active'},{id:'other-account',reference:'A-002',status:'active'}],
  locations:[{id:'location',accountId:'account',reference:'Café north',address:'123 Fictional Street',status:'active'},
    {id:'other-location',accountId:'other-account',reference:'Café south',address:'456 Fictional Street',status:'active'}]};
const saveProfile=(id,extra={})=>({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Fictional supplier setup',supplierId:id,expectedVersion:0,profile,...extra});
const mapping=(id,supplierId='supplier-six',extra={})=>({action:'save_mapping',companyId:'a',operationId:crypto.randomUUID(),reason:'Reviewed pack setup',mappingId:id,expectedVersion:0,
  supplierId,expectedSupplierVersion:1,accountId:'account',locationId:'location',productId:'milk',expectedConfigId:'config-milk',expectedConfigVersion:1,
  sku:'MILK',description:'Milk, "café"',unitLabel:'case',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:null,...extra});
const fail=code=>e=>e.code===code;
const upstream=()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'purchasing_%' AND name NOT LIKE 'purchase_order_%' ORDER BY name").all()
  .map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]));
const before=upstream();const firstInput=saveProfile('supplier-six');const first=await registry.saveProfile(firstInput);
assert.deepEqual(await registry.saveProfile(firstInput),first);assert.equal(first.profile.email,null);assert.equal(first.emailAcceptanceReportedBy,'manager');
const second=await registry.saveProfile(saveProfile('supplier-twelve',{profile:{...profile,name:'Fictional Twelve Supplier',email:'orders@example.invalid',emailAcceptance:{status:'manager_reported_accepted',note:'Fictional manager report'}}}));
const sixInput=mapping('six');const six=await registry.saveMapping(sixInput);
const twelve=await registry.saveMapping(mapping('twelve',second.id,{packAmount:'12',estimatedUnitMinor:'1000'}));
assert.equal(six.stockUnitsPerPack.minor,'6');assert.equal(twelve.stockUnitsPerPack.minor,'12');
assert.equal(f.sql.prepare("SELECT purchase_quantity_minor FROM inventory_config_versions WHERE id='config-milk'").get().purchase_quantity_minor,'30');
assert.equal(upstream(),before);
assert.deepEqual(await registry.saveMapping(sixInput),six);assert.equal((await registry.units('a','milk')).config.dimension,'count');
for(const who of [null,'employee','b-manager']){actor=who;
  for(const run of [()=>registry.list('a'),()=>registry.profile('a',first.id),()=>registry.history('a',first.id,'profile'),()=>registry.mapping('a',six.id),()=>registry.units('a','milk'),()=>registry.projection('a',six.id),()=>registry.saveProfile(saveProfile('forbidden'))])await assert.rejects(run(),fail('forbidden'));
}actor='b-manager';await assert.rejects(registry.profile('b',first.id),fail('missing'));actor='manager';
await assert.rejects(registry.saveProfile({...firstInput,profile:{...profile,name:'Changed'}}),fail('conflict'));
actor='owner';await assert.rejects(registry.saveProfile(firstInput),fail('conflict'));actor='manager';
for(const extra of [{packAmount:'0'},{packAmount:'-1'},{packAmount:'1.5'},{packUnitId:'L'},{packAmount:'9223372036854775808'},
  {productId:'foreign'},{expectedConfigVersion:9},{locationId:'other-location'},{packUnitId:'unknown'},
  {estimatedUnitMinor:'1.25'},{estimatedUnitMinor:'-1'}])await assert.rejects(registry.saveMapping(mapping(crypto.randomUUID(),'supplier-six',extra)));
await assert.rejects(registry.saveMapping(mapping('duplicate-sku')),fail('conflict'));
for(const p of [{...profile,accounts:[profile.accounts[0],profile.accounts[0]]},{...profile,locations:[{...profile.locations[0],accountId:'missing'}]},
  {...profile,emailAcceptance:{status:'manager_reported_accepted',note:'Reported acceptance'}},
  {...profile,locations:[]}])await assert.rejects(registry.saveProfile(saveProfile('invalid',{profile:p})),fail('invalid_request'));
const draftInput=(supplierId,mappingId,extra={})=>({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'registry',supplierRef:{id:supplierId,version:1,accountId:'account',locationId:'location'},
  capMinor:'10000',notes:'Not sent',lines:[{kind:'stock',mappingId,mappingVersion:1,packs:'2'}],...extra});
const dsix=await po.create(draftInput(first.id,six.id)),dtwelve=await po.create(draftInput(second.id,twelve.id));
assert.equal(dsix.snapshot.contract,'pantrack.purchase-order-draft.v2');assert.equal(dsix.snapshot.lines[0].stockQuantity.minor,'12');
assert.equal(dtwelve.snapshot.lines[0].stockQuantity.minor,'24');assert.equal(dtwelve.snapshot.knownSubtotalMinor,'2000');
assert.equal(dsix.snapshot.lines[0].estimatedLineMinor,null);assert.equal(dsix.snapshot.supplier.email,null);
assert.deepEqual(dsix.snapshot.registry.profile,first);assert.deepEqual(dsix.snapshot.registry.mappings[0].mapping,six);
assert.match(dsix.snapshot.warnings.join(' '),/acceptance is unknown/);assert.match(dtwelve.snapshot.warnings.join(' '),/manager-reported/);
assert.equal(upstream(),before,'Registry/PO actions preserve inventory, proposal history and all unrelated tables.');
const duplicateLines=[{kind:'stock',mappingId:six.id,mappingVersion:1,packs:'2'},{kind:'stock',mappingId:six.id,mappingVersion:1,packs:'1'}];
await assert.rejects(po.create(draftInput(first.id,six.id,{lines:duplicateLines})),fail('invalid_request'));
await assert.rejects(po.create(draftInput(first.id,twelve.id)),fail('source_changed'));
await assert.rejects(po.create(draftInput(first.id,six.id,{lines:[{kind:'stock',mappingId:six.id,mappingVersion:1,packs:'0'}]})),fail('invalid_request'));
await assert.rejects(po.create(draftInput(first.id,six.id,{lines:[{kind:'stock',mappingId:six.id,mappingVersion:1,packs:'2',sku:'client override'}]})),fail('invalid_request'));
const mixed=await po.create(draftInput(first.id,six.id,{lines:[{kind:'stock',mappingId:six.id,mappingVersion:1,packs:'1'},
  {kind:'non_stock',sku:'SERVICE',description:'Delivery service',unitLabel:'visit',packs:'1',estimatedUnitMinor:null}]}));
assert.equal(mixed.snapshot.lines[1].stockQuantity,null);
// A supplier or mapping can change after projection but before the PO batch.
const poState=()=>JSON.stringify(['purchase_order_drafts','purchase_order_draft_lines','purchase_order_draft_operations','purchase_order_draft_events'].map(t=>f.sql.prepare(`SELECT * FROM ${t}`).all()));
for(const kind of ['profile','mapping']){
  const supplierId=`po-race-${kind}`,mappingId=`po-race-map-${kind}`;
  const p=await registry.saveProfile(saveProfile(supplierId)),m=await registry.saveMapping(mapping(mappingId,supplierId));
  const beforeRace=poState();f.db.beforeBatch=()=>{
    if(kind==='profile'){
      f.sql.prepare('UPDATE purchasing_suppliers SET version=2 WHERE company_id=? AND id=?').run('a',supplierId);
      f.sql.prepare('INSERT INTO purchasing_supplier_versions VALUES(?,?,?,?)').run('a',supplierId,2,JSON.stringify({...p,version:2}));
    }else{
      f.sql.prepare("UPDATE purchasing_mappings SET version=2,status='archived' WHERE company_id=? AND id=?").run('a',mappingId);
      f.sql.prepare('INSERT INTO purchasing_mapping_versions VALUES(?,?,?,?)').run('a',mappingId,2,JSON.stringify({...m,version:2,status:'archived'}));
    }
  };
  await assert.rejects(po.create(draftInput(supplierId,mappingId)),fail('conflict'));
  assert.equal(poState(),beforeRace,'A changed registry source leaves no partial PO, receipt or audit.');
}
const edited=await registry.saveProfile(saveProfile(first.id,{expectedVersion:1,profile:{...profile,email:'new@example.invalid',locations:profile.locations.map(l=>({...l,address:'New fictional address'}))}}));
await assert.rejects(po.create(draftInput(first.id,six.id)),fail('source_changed'));
const editedMap=await registry.saveMapping(mapping(six.id,first.id,{expectedVersion:1,expectedSupplierVersion:2,packAmount:'8',estimatedUnitMinor:'900'}));
assert.equal(editedMap.stockUnitsPerPack.minor,'8');assert.deepEqual(await po.get('a',dsix.snapshot.id),dsix);
assert.equal((await registry.history('a',first.id,'profile')).versions.length,2);
assert.deepEqual(await registry.profile('a',first.id,1),first);assert.equal((await registry.history('a',six.id,'mapping')).versions.length,2);
await assert.rejects(registry.saveProfile(saveProfile(first.id,{expectedVersion:2,profile:{...edited.profile,accounts:[edited.profile.accounts[0]]}})),fail('invalid_request'));
await assert.rejects(registry.saveProfile(saveProfile(first.id,{expectedVersion:2,profile:{...edited.profile,locations:[{...edited.profile.locations[0],accountId:'other-account'},edited.profile.locations[1]]}})),fail('invalid_request'));
// Fresh membership and parent/config guards commit atomically, with no incomplete versions/audits.
const registryState=()=>JSON.stringify(['purchasing_suppliers','purchasing_supplier_versions','purchasing_mappings','purchasing_mapping_versions','purchasing_registry_operations','purchasing_registry_events'].map(t=>f.sql.prepare(`SELECT * FROM ${t}`).all()));
const beforeRevocation=registryState();f.db.beforeBatch=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
await assert.rejects(registry.saveProfile(saveProfile('revoked')),fail('forbidden'));assert.equal(registryState(),beforeRevocation);
f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
f.db.loseAcknowledgment=true;const lostInput=saveProfile('lost');const lost=await registry.saveProfile(lostInput);assert.deepEqual(await registry.saveProfile(lostInput),lost);
const same=saveProfile('same');const sameResults=await Promise.all([registry.saveProfile(same),registry.saveProfile(same)]);assert.deepEqual(...sameResults);
const competeBase=saveProfile('same',{expectedVersion:1});const competing=await Promise.allSettled([registry.saveProfile(competeBase),registry.saveProfile({...competeBase,operationId:crypto.randomUUID(),profile:{...profile,name:'Competing'}})]);
assert.deepEqual(competing.map(r=>r.status).sort(),['fulfilled','rejected']);
f.sql.exec("CREATE TEMP TRIGGER registry_injected BEFORE INSERT ON purchasing_registry_events BEGIN SELECT RAISE(ABORT,'injected failure'); END");
const beforeFailure=registryState();await assert.rejects(registry.saveMapping(mapping('injected',second.id,{sku:'INJECTED'})),fail('conflict'));
assert.equal(registryState(),beforeFailure);f.sql.exec('DROP TRIGGER registry_injected');
// Real A configuration edit invalidates mapping use, not historical drafts.
await new D1InventoryManagementService(f.db,{clock}).configure({companyId:'a',actor:'manager',operationId:'new-stock-config',productId:'milk',expectedConfigId:'config-milk',
  stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'item pack',purchaseAmount:'30',purchaseContentUnitId:'each',effectiveAt:'2026-10-04T12:00:00.000Z'});
await assert.rejects(registry.projection('a',twelve.id),fail('source_changed'));
assert.ok((await registry.mappings('a',second.id)).mappings[0].warning);assert.deepEqual(await po.get('a',dtwelve.snapshot.id),dtwelve);
const currentConfig=await registry.config('a','milk');
await registry.saveMapping(mapping(twelve.id,second.id,{expectedVersion:1,expectedConfigId:currentConfig.id,expectedConfigVersion:currentConfig.version,packAmount:'12'}));
// Custom unit ownership and retirement are enforced without guessed conversions.
f.sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
  VALUES('a','milk','bottle',1,'custom','count','Bottle (2 each)','2','1','manager',?)`).run(clock.now().toISOString());
const custom=await registry.saveMapping(mapping('custom',second.id,{sku:'CUSTOM',packAmount:'3',packUnitId:'bottle',expectedConfigId:currentConfig.id,expectedConfigVersion:currentConfig.version}));
assert.equal(custom.stockUnitsPerPack.minor,'6');assert.equal((await registry.units('a','milk')).units[0].kind,'custom');
const beforeUnitRace=poState();f.db.beforeBatch=()=>f.sql.prepare("UPDATE product_unit_versions SET retired_at=? WHERE company_id='a' AND product_id='milk' AND unit_id='bottle'").run(clock.now().toISOString());
await assert.rejects(po.create(draftInput(second.id,custom.id)),fail('conflict'));
assert.equal(poState(),beforeUnitRace,'Retirement at commit leaves no partial PO.');
await assert.rejects(registry.projection('a',custom.id),fail('source_changed'));
const parentRace=mapping('parent-race',second.id,{sku:'PARENT-RACE',expectedConfigId:currentConfig.id,expectedConfigVersion:currentConfig.version});
f.db.beforeBatch=()=>f.sql.exec("UPDATE purchasing_suppliers SET version=version+1 WHERE company_id='a' AND id='supplier-twelve'");
const oldMappings=f.sql.prepare('SELECT * FROM purchasing_mappings').all();await assert.rejects(registry.saveMapping(parentRace),fail('conflict'));
assert.deepEqual(f.sql.prepare('SELECT * FROM purchasing_mappings').all(),oldMappings);
// Repair the intentionally raced fixture by inserting a real next snapshot; no production repair is implied.
f.sql.prepare('INSERT INTO purchasing_supplier_versions VALUES(?,?,?,?)').run('a',second.id,2,JSON.stringify({...second,version:2}));
const archiveInput={action:'archive_profile',companyId:'a',supplierId:first.id,expectedVersion:2,operationId:'archive-profile',reason:'Supplier no longer used'};
f.db.loseAcknowledgment=true;const archived=await registry.archiveProfile(archiveInput);assert.equal(archived.status,'archived');assert.deepEqual(await registry.archiveProfile(archiveInput),archived);
await assert.rejects(registry.projection('a',six.id),fail('source_changed'));assert.deepEqual(await po.get('a',dsix.snapshot.id),dsix);
const am={action:'archive_mapping',companyId:'a',mappingId:twelve.id,expectedVersion:2,operationId:'archive-mapping',reason:'Mapping no longer used'};
assert.equal((await registry.archiveMapping(am)).status,'archived');assert.deepEqual(await registry.archiveMapping(am),await registry.mapping('a',twelve.id));
for(const t of ['purchasing_supplier_versions','purchasing_mapping_versions','purchasing_registry_operations','purchasing_registry_events']){
  assert.throws(()=>f.sql.exec(`UPDATE ${t} SET company_id=company_id`),/immutable/);assert.throws(()=>f.sql.exec(`DELETE FROM ${t}`),/cannot be deleted/);
}
for(let i=0;i<21;i++)await registry.saveProfile(saveProfile(`paged-${i}`));assert.equal((await registry.list('a')).suppliers.length,20);assert.equal((await registry.list('a')).hasMore,true);
assert.ok((await registry.list('a',20)).suppliers.length>0);await assert.rejects(registry.list('a',-1),fail('invalid_request'));
assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
// Compatibility migration preserves existing v1 drafts byte-for-byte and creates no suppliers.
const upgrade=entries.find(e=>e.tag.endsWith('_purchasing_supplier_registry'));assert.ok(upgrade,'Missing purchasing_supplier_registry migration');
const old=new DatabaseSync(':memory:');old.exec('PRAGMA foreign_keys=ON');for(const e of entries.filter(e=>e.idx<upgrade.idx))old.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
old.exec("INSERT INTO companies VALUES('legacy','Legacy','2026-01-01')");
const legacySnapshot=JSON.stringify({companyId:'legacy',id:'old',number:'PO-OLD',supplier:{id:'manual'},contract:'pantrack.purchase-order-draft.v1'});
old.prepare("INSERT INTO purchase_order_drafts VALUES('legacy','old','PO-OLD','manual','draft',1,?,'2026-01-01')").run(legacySnapshot);
const legacy=JSON.stringify(old.prepare('SELECT * FROM purchase_order_drafts').all());old.exec(readFileSync(`drizzle/${upgrade.tag}.sql`,'utf8'));
assert.equal(JSON.stringify(old.prepare('SELECT * FROM purchase_order_drafts').all()),legacy);assert.equal(old.prepare('SELECT count(*) n FROM purchasing_suppliers').get().n,0);
old.close();f.sql.close();
console.log('PASS: versioned registry and exact supplier packs, role/company isolation, scoped units, stale config/parent guards, immutable v1/v2 drafts, atomic races/replay/lost responses, archives/history/pagination and additive compatibility.');
