import assert from 'node:assert/strict';
import {exportFixture,core} from './helpers/purchase-order-export.mjs';
const f=await exportFixture(),bad=code=>error=>error.code===code;
try{
  await f.source({productId:'beans'});
  const stock={kind:'stock',productId:'beans',expectedConfigId:'config-beans',expectedConfigVersion:1,
    sku:'BEANS',description:'Café beans, "house"',packs:'3',estimatedUnitMinor:'125'};
  const first=await f.drafts.create(f.create({lines:[stock,f.nonStock]})),selection=f.select(first);
  let before=f.allTables(),reads=f.state.exportReads;
  const exported=await f.exports.get(selection);
  assert.equal(f.state.exportReads,reads+1,'Membership and all financial/document data use one read.');
  assert.equal(exported.contract,'pantrack.purchase-order-export.v1');
  assert.equal(exported.label,'Draft — no order placed.');assert.equal(exported.revision,1);
  assert.equal(exported.status,'draft');assert.equal(exported.draft.number,first.snapshot.number);
  assert.deepEqual(exported.draft.supplier,first.snapshot.supplier);
  assert.deepEqual(exported.draft.lines,first.snapshot.lines);
  assert.equal(exported.draft.lines[0].stockQuantity.minor,'90');
  assert.equal(exported.draft.lines[0].estimatedLineMinor,'375');
  assert.equal(exported.draft.lines[1].stockQuantity,null);assert.equal(exported.draft.lines[1].estimatedLineMinor,null);
  assert.equal(exported.draft.knownSubtotalMinor,'375');assert.equal(exported.draft.pricesComplete,false);
  assert.deepEqual(exported.draft.warnings,first.snapshot.warnings);
  assert.ok(exported.limitations.some(text=>text.includes('not been revalidated')));
  assert.equal(exported.draft.createdBy,undefined,'Internal creator metadata is not needed in the document.');
  assert.ok(Object.isFrozen(exported)&&Object.isFrozen(exported.draft.lines[0].stockQuantity));
  assert.deepEqual(await f.exports.get(selection),exported);assert.equal(f.allTables(),before);
  for(const user of [null,'employee','b-manager']){
    f.state.user=user;await assert.rejects(f.exports.get(selection),bad('forbidden'));
  }
  f.state.user='owner';assert.deepEqual(await f.exports.get(selection),exported);
  f.state.user='b-manager';await assert.rejects(f.exports.get({...selection,companyId:'b'}),bad('missing'));
  f.state.user='manager';await assert.rejects(f.exports.get({...selection,companyId:'b'}),bad('forbidden'));
  assert.equal(f.allTables(),before);
  for(const request of [{...selection,revision:0},{...selection,revision:1.5},{...selection,revision:'1'},
    {...selection,revision:Number.MAX_SAFE_INTEGER+1},{...selection,snapshot:first.snapshot},
    {...selection,orderId:''}])await assert.rejects(f.exports.get(request),bad('invalid_request'));

  // Real writes between request authorization and the single source read must be observed.
  f.state.beforeExportRead=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
  await assert.rejects(f.exports.get(selection),bad('forbidden'));
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
  f.state.beforeExportRead=()=>f.drafts.edit(f.edit(first,{lines:[stock,f.nonStock]}));
  await assert.rejects(f.exports.get(selection),bad('conflict'));
  const edited=await f.drafts.get('a',selection.orderId),next=await f.exports.get(f.select(edited));
  assert.equal(next.revision,2);assert.equal(next.draft.notes,'Edited notes');
  const reviewed=await f.drafts.review({action:'review',companyId:'a',orderId:edited.snapshot.id,expectedRevision:edited.revision,
    operationId:crypto.randomUUID(),acknowledgeWarnings:true});
  const reviewExport=await f.exports.get(f.select(reviewed));
  assert.equal(reviewExport.status,'reviewed');assert.deepEqual(reviewExport.review,reviewed.review);
  before=f.allTables();await assert.rejects(f.exports.get(f.select(edited)),bad('conflict'));assert.equal(f.allTables(),before);
  f.state.beforeExportRead=()=>f.drafts.cancel({action:'cancel',companyId:'a',orderId:reviewed.snapshot.id,
    expectedRevision:reviewed.revision,operationId:crypto.randomUUID(),reason:'Replace fictional draft'});
  await assert.rejects(f.exports.get(f.select(reviewed)),bad('conflict'));
  const canceled=await f.drafts.get('a',selection.orderId);await assert.rejects(f.exports.get(f.select(canceled)),bad('conflict'));

  // Exact saved quantities beyond Number precision, without coercion or live recomputation.
  f.sql.prepare("INSERT INTO products(owner,id,data) VALUES('a','large','{}')").run();
  f.sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
    VALUES('a','large','each',1,'curated','count','each','1','1','manager',?)`).run(first.snapshot.createdAt);
  f.sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,effective_from,created_by,created_at)
    VALUES('a','large','large-config',1,'active','each',1,'case','9007199254740993',?,'manager',?)`).run(first.snapshot.createdAt,first.snapshot.createdAt);
  const large=await f.drafts.create(f.create({lines:[{...stock,productId:'large',expectedConfigId:'large-config'}]}));
  assert.equal((await f.exports.get(f.select(large))).draft.lines[0].stockQuantity.minor,'27021597764222979');
  const free=await f.drafts.create(f.create({lines:[{...f.nonStock,estimatedUnitMinor:'0'}]}));
  const freeExport=await f.exports.get(f.select(free));
  assert.equal(freeExport.draft.pricesComplete,true);assert.equal(freeExport.draft.lines[0].estimatedLineMinor,'0');

  const v1=await f.source({productId:'proposal-one'}),v2=await f.source({productId:'proposal-two',clover:true});
  const proposals=await f.drafts.create(f.create({source:'proposals',lines:undefined,
    proposals:[v1,v2].map(h=>({id:h.proposalId,revision:h.revision}))}));
  const proposalExport=await f.exports.get(f.select(proposals));
  assert.deepEqual(proposalExport.draft.lines.map(line=>line.proposal.contract),[v1.contract,v2.contract]);
  for(const line of proposalExport.draft.lines){
    const saved=proposals.snapshot.lines.find(item=>item.id===line.id);
    assert.equal(line.packs,saved.packs);assert.deepEqual(line.stockQuantity,saved.stockQuantity);
    assert.deepEqual(line.proposal.warnings,saved.proposal.warnings);
  }
  // Stock movement after saving is not substituted into the immutable saved draft.
  f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE product_id='proposal-one'");
  assert.deepEqual(await f.exports.get(f.select(proposals)),proposalExport);

  const registry=new core.D1PurchasingSuppliers(f.db,{identity:async()=>f.state.user,clock:f.options.clock});
  const profile={name:'Fictional registered supplier',email:null,telephone:'DO_NOT_EXPORT_PHONE',paymentTerms:'DO_NOT_EXPORT_TERMS',
    minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'DO_NOT_EXPORT_INSTRUCTIONS',notes:'DO_NOT_EXPORT_INTERNAL',
    emailAcceptance:{status:'unknown',note:''},accounts:[{id:'stable-account',reference:'Displayed account',status:'active'}],
    locations:[{id:'stable-location',accountId:'stable-account',reference:'Displayed location',address:'123 Fictional Street',status:'active'}]};
  const supplier=await registry.saveProfile({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Fictional setup',supplierId:'registered',expectedVersion:0,profile});
  const mapping=await registry.saveMapping({action:'save_mapping',companyId:'a',operationId:crypto.randomUUID(),reason:'Fictional six-unit pack',
    mappingId:'export-mapping',expectedVersion:0,supplierId:supplier.id,expectedSupplierVersion:1,accountId:'stable-account',locationId:'stable-location',
    productId:'beans',expectedConfigId:'config-beans',expectedConfigVersion:1,sku:'REGISTERED-BEANS',description:'Saved supplier pack',
    unitLabel:'six-unit case',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:'250'});
  const registered=await f.drafts.create({action:'create',source:'registry',companyId:'a',operationId:crypto.randomUUID(),
    supplierRef:{id:supplier.id,version:1,accountId:'stable-account',locationId:'stable-location'},capMinor:'10000',notes:'Registry draft',
    lines:[{kind:'stock',mappingId:mapping.id,mappingVersion:1,packs:'2'},f.nonStock]});
  const registryExport=await f.exports.get(f.select(registered));
  assert.equal(registryExport.draft.contract,'pantrack.purchase-order-draft.v2');
  assert.equal(registryExport.draft.supplier.email,null);
  assert.deepEqual(registryExport.supplierReference,{id:supplier.id,version:1,accountId:'stable-account',locationId:'stable-location'});
  assert.ok(!JSON.stringify(registryExport).includes('DO_NOT_EXPORT_'));
  assert.equal(registryExport.draft.registry,undefined);
  assert.equal(registryExport.draft.lines[0].mappingId,mapping.id);assert.equal(registryExport.draft.lines[0].mappingVersion,1);
  assert.equal(registryExport.draft.lines[0].stockUnitsPerPack.minor,'6');assert.equal(registryExport.draft.lines[0].stockQuantity.minor,'12');
  assert.equal(f.sql.prepare("SELECT purchase_quantity_minor FROM inventory_config_versions WHERE id='config-beans'").get().purchase_quantity_minor,'30');
  await registry.saveProfile({action:'save_profile',companyId:'a',operationId:crypto.randomUUID(),reason:'Later supplier rename',
    supplierId:supplier.id,expectedVersion:1,profile:{...profile,name:'New current supplier name'}});
  assert.deepEqual(await f.exports.get(f.select(registered)),registryExport,'Later registry edits cannot replace the saved supplier/version or pack.');

  const row=f.sql.prepare(`SELECT h.company_id,h.id,h.number,h.supplier_id,h.revision current_revision,h.status current_status,
    r.status revision_status,r.snapshot_json,e.kind event_kind,e.actor event_actor,e.at event_at
    FROM purchase_order_drafts h JOIN purchase_order_draft_revisions r ON r.company_id=h.company_id AND r.order_id=h.id AND r.revision=h.revision
    JOIN purchase_order_draft_events e ON e.company_id=h.company_id AND e.order_id=h.id AND e.revision=h.revision WHERE h.id=?`).get(registered.snapshot.id);
  for(const mutate of [s=>{s.companyId='foreign';},s=>{s.pricesComplete=true;},s=>{s.knownSubtotalMinor='1';},
    s=>{delete s.registry.group;},s=>{s.lines[0].stockQuantity={dimension:'count',minor:'1'};}]){
    const snapshot=JSON.parse(row.snapshot_json);mutate(snapshot);
    assert.throws(()=>core.buildPurchaseOrderExport({...row,snapshot_json:JSON.stringify(snapshot)},f.select(registered)),bad('storage_failure'));
  }
  assert.throws(()=>core.buildPurchaseOrderExport({...row,snapshot_json:'invalid'},f.select(registered)),bad('storage_failure'));
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=()=>{calls++;throw Error('No provider access during export.');};
  before=f.allTables();try{
    for(const view of [large,free,proposals,registered])await f.exports.get(f.select(view));
    assert.equal(calls,0);assert.equal(f.allTables(),before);
  }finally{globalThis.fetch=oldFetch;}
}finally{f.sql.close();}
console.log('PASS: authorized single-read saved exports, manual/non-stock/proposal/registry snapshots, exact quantities, privacy, immutable copies, revision/cancellation/membership races and unchanged tables with zero provider calls.');
