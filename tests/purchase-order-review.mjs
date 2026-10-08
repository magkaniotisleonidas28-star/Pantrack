import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {fixture,LocalD1,entries} from './helpers/supplier-simulation.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-purchase-order-drafts'; export * from './src/lib/d1-purchasing-suppliers'; export * from './src/components/workspace/purchase-order-editor-model';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-review-tests.mjs'});
const {D1PurchaseOrderDrafts,D1PurchasingSuppliers,editorFrom,snapshotChanges,cents}=await import('../.sites-runtime/po-review-tests.mjs');
const f=await fixture(),clock={now:()=>new Date('2026-10-01T12:00:00.000Z')};
let actor='manager';const options={identity:async()=>actor,clock,salesPolicy:f.options.salesPolicy};
const po=new D1PurchaseOrderDrafts(f.db,options),registry=new D1PurchasingSuppliers(f.db,options);
const supplier={id:'fake-supplier',name:'Fictional supplier',email:'orders@example.invalid',accountId:'fake-account',locationId:'fake-location',deliveryAddress:'123 Example Street'};
const line={kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:null};
const create=(extra={})=>Object.fromEntries(Object.entries({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'manual',supplier,capMinor:'10000',notes:'Review only',lines:[line],...extra}).filter(([,value])=>value!==undefined));
const edit=(v,extra={})=>({action:'edit',companyId:'a',operationId:crypto.randomUUID(),orderId:v.snapshot.id,expectedRevision:v.revision,
  source:v.snapshot.source,supplier:v.snapshot.supplier,capMinor:v.snapshot.capMinor,notes:'Changed delivery notes',lines:[line],reason:'Correct delivery instructions',...extra});
const review=(v,extra={})=>({action:'review',companyId:'a',operationId:crypto.randomUUID(),orderId:v.snapshot.id,expectedRevision:v.revision,acknowledgeWarnings:true,...extra});
const fail=code=>e=>e.code===code;
const tables=()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'purchase_order_%' ORDER BY name").all()
  .map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]));
const state=()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'purchase_order_%' ORDER BY name").all()
  .map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]));
const before=tables(),first=await po.create(create());
const editInput=edit(first);f.db.loseAcknowledgment=true;
const edited=await po.edit(editInput);assert.equal(edited.revision,2);assert.equal(edited.snapshot.notes,editInput.notes);
assert.deepEqual(await po.edit(editInput),edited);assert.deepEqual(await po.get('a',first.snapshot.id,1),first);
assert.equal(f.sql.prepare('SELECT snapshot_json FROM purchase_order_drafts WHERE id=?').get(first.snapshot.id).snapshot_json,JSON.stringify(first.snapshot));
await assert.rejects(po.edit({...editInput,notes:'Conflicting reuse'}),fail('conflict'));
await assert.rejects(po.edit(edit(first)),fail('conflict'));
await assert.rejects(po.edit(edit(edited,{notes:edited.snapshot.notes})),fail('invalid_request'));
await assert.rejects(po.edit(edit(edited,{capMinor:'1',lines:[{...line,estimatedUnitMinor:'1'}]})),fail('invalid_request'));
await assert.rejects(po.edit(edit(edited,{supplier:{...supplier,accountId:'other'}})),fail('invalid_request'));
await assert.rejects(po.edit(edit(edited,{reason:'x'})),fail('invalid_request'));
await assert.rejects(po.review(review(edited,{acknowledgeWarnings:false})),fail('invalid_request'));
const reviewInput=review(edited);f.db.loseAcknowledgment=true;
const reviewed=await po.review(reviewInput);assert.equal(reviewed.status,'reviewed');
assert.deepEqual(reviewed.review,{contentRevision:2,actor:'manager',at:clock.now().toISOString()});
assert.deepEqual(reviewed.snapshot,edited.snapshot);assert.equal(reviewed.snapshot.lines[0].estimatedLineMinor,null);
assert.deepEqual(await po.get('a',first.snapshot.id),reviewed);assert.deepEqual(await po.review(reviewInput),reviewed);
await assert.rejects(po.review(review(reviewed)),fail('conflict'));
actor='owner';await assert.rejects(po.review(reviewInput),fail('conflict'));
const revised=await po.edit(edit(reviewed,{notes:'Owner correction'}));assert.equal(revised.status,'draft');assert.equal(revised.review,undefined);
assert.equal(revised.events.length,4);assert.deepEqual(await po.get('a',first.snapshot.id,3),reviewed);
assert.equal(tables(),before,'Edits and review do not reserve spending/quantity or mutate inventory/proposals.');
const ownerReview=await po.review(review(revised));assert.equal(ownerReview.review.actor,'owner');
const canceled=await po.cancel({action:'cancel',companyId:'a',operationId:'cancel-reviewed',orderId:first.snapshot.id,expectedRevision:5,reason:'Replace reviewed draft'});
assert.equal(canceled.status,'canceled');assert.equal(canceled.review,undefined);assert.equal(canceled.revision,6);
await assert.rejects(po.edit(edit(canceled)),fail('conflict'));await assert.rejects(po.review(review(canceled)),fail('conflict'));
actor='manager';
const active=await po.create(create());
for(const who of [null,'employee','b-manager']){
  actor=who;
  for(const run of [()=>po.edit(edit(active)),()=>po.review(review(active)),()=>po.get('a',active.snapshot.id,1)])await assert.rejects(run(),fail('forbidden'));
}actor='b-manager';await assert.rejects(po.get('b',active.snapshot.id,1),fail('missing'));actor='manager';
for(const mutate of [v=>po.edit(edit(v)),v=>po.review(review(v))]){
  const v=await po.create(create()),prior=state();
  f.db.beforeBatch=()=>f.sql.exec("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'");
  await assert.rejects(mutate(v),fail('forbidden'));assert.equal(state(),prior);
  f.sql.exec("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'");
}
const competing=await po.create(create());
const races=await Promise.allSettled([po.edit(edit(competing)),po.review(review(competing))]);
assert.deepEqual(races.map(r=>r.status).sort(),['fulfilled','rejected']);
assert.equal((await po.get('a',competing.snapshot.id)).revision,2);
const same=await po.create(create()),sameInput=review(same);
const repeats=await Promise.all([po.review(sameInput),po.review(sameInput)]);assert.deepEqual(...repeats);
f.sql.exec("CREATE TEMP TRIGGER review_injected BEFORE INSERT ON purchase_order_draft_revisions WHEN NEW.revision>1 BEGIN SELECT RAISE(ABORT,'injected'); END");
const prior=state();await assert.rejects(po.edit(edit(active)),fail('conflict'));assert.equal(state(),prior);f.sql.exec('DROP TRIGGER review_injected');

const h=await f.source({productId:'proposal-stock'});
const p=await po.create(create({source:'proposals',lines:undefined,proposals:[{id:h.proposalId,revision:h.revision}]}));
const pe=edit(p);delete pe.lines;
const updatedProposal=await po.edit(pe);assert.deepEqual(updatedProposal.snapshot.lines,p.snapshot.lines);
await assert.rejects(po.edit({...pe,operationId:crypto.randomUUID(),expectedRevision:2,lines:[{...p.snapshot.lines[0],packs:'9'}]}),fail('invalid_request'));
assert.equal((await po.review(review(updatedProposal))).status,'reviewed');
const p2=await po.create(create({source:'proposals',lines:undefined,proposals:[{id:h.proposalId,revision:h.revision}]}));
const beforeRace=state();f.db.beforeBatch=()=>f.sql.exec("UPDATE inventory_balances_exact SET version=version+1 WHERE product_id='proposal-stock'");
await assert.rejects(po.review(review(p2)),fail('conflict'));assert.equal(state(),beforeRace);

await f.source({productId:'mapped'});
const profile={name:'Fictional supply',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'',
  emailAcceptance:{status:'unknown',note:''},accounts:[{id:'a1',reference:'Duplicate label',status:'active'},{id:'a2',reference:'Duplicate label',status:'active'}],
  locations:[{id:'l1',accountId:'a1',reference:'Cafe',address:'First',status:'active'},{id:'l2',accountId:'a2',reference:'Cafe',address:'Second',status:'active'}]};
await registry.saveProfile({action:'save_profile',companyId:'a',operationId:'profile',supplierId:'registry',expectedVersion:0,reason:'Supplier setup',profile});
const mapInput={action:'save_mapping',companyId:'a',operationId:'map',mappingId:'map',expectedVersion:0,supplierId:'registry',expectedSupplierVersion:1,
  accountId:'a2',locationId:'l2',productId:'mapped',expectedConfigId:'config-mapped',expectedConfigVersion:1,sku:'MAPPED',description:'Mapped stock',unitLabel:'case',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:'100',reason:'Exact supplier pack'};
await registry.saveMapping(mapInput);
const regInput={action:'create',companyId:'a',operationId:'registry-draft',source:'registry',supplierRef:{id:'registry',version:1,accountId:'a2',locationId:'l2'},
  capMinor:'10000',notes:'',lines:[{kind:'stock',mappingId:'map',mappingVersion:1,packs:'2'}]};
const reg=await po.create(regInput);assert.equal(reg.snapshot.registry.group.accountId,'a2');
const re={...regInput,action:'edit',operationId:'registry-edit',orderId:reg.snapshot.id,expectedRevision:1,reason:'Correct pack count',lines:[{...regInput.lines[0],packs:'3'}]};
const regEdited=await po.edit(re);assert.equal(regEdited.snapshot.lines[0].stockQuantity.minor,'18');assert.deepEqual(regEdited.snapshot.registry.profile,reg.snapshot.registry.profile);
await assert.rejects(po.edit({...re,expectedRevision:2,operationId:'wrong-group',supplierRef:{...re.supplierRef,accountId:'a1',locationId:'l1'}}),fail('invalid_request'));
await registry.saveMapping({...mapInput,operationId:'map-two',expectedVersion:1,packAmount:'8'});
await assert.rejects(po.review(review(regEdited)),fail('source_changed'));
const replaced=await po.edit({...re,operationId:'replace-map',expectedRevision:2,lines:[{...re.lines[0],mappingVersion:2}]});
assert.equal(replaced.snapshot.lines[0].stockQuantity.minor,'24');assert.equal((await po.get('a',reg.snapshot.id,2)).snapshot.lines[0].stockQuantity.minor,'18');
assert.deepEqual([editorFrom(reg.snapshot).accountId,editorFrom(reg.snapshot).locationId],['a2','l2']);
assert.equal(editorFrom(first.snapshot).lines[0].estimate,'');
const legacyPrice={...first.snapshot,lines:[{...first.snapshot.lines[0],estimatedLineMinor:'600',estimatedUnitMinor:undefined,packs:'3'}]};
assert.equal(editorFrom(legacyPrice).lines[0].estimate,'2.00');assert.equal(cents('9999999999.99'),'999999999999');
assert.throws(()=>cents('1.001'));assert.throws(()=>cents('-1'));
assert.match(snapshotChanges(regEdited.snapshot,replaced.snapshot).join('\n'),/Mapping version: 1 → 2/);
assert.match(snapshotChanges(regEdited.snapshot,replaced.snapshot).join('\n'),/Pack quantity: 6 → 8/);
const registryBeforeRace=state();f.db.beforeBatch=()=>{
  f.sql.exec("UPDATE purchasing_suppliers SET version=2 WHERE id='registry'");
  const saved=reg.snapshot.registry.profile;
  f.sql.prepare('INSERT INTO purchasing_supplier_versions VALUES(?,?,?,?)').run('a','registry',2,JSON.stringify({...saved,version:2}));
};
await assert.rejects(po.review(review(replaced)),fail('conflict'));assert.equal(state(),registryBeforeRace);
await assert.rejects(po.edit({...re,operationId:'stale-profile',expectedRevision:3}),fail('source_changed'));
for(const t of ['purchase_order_draft_revisions','purchase_order_draft_events','purchase_order_draft_operations']){
  assert.throws(()=>f.sql.exec(`UPDATE ${t} SET company_id=company_id`),/immutable/);assert.throws(()=>f.sql.exec(`DELETE FROM ${t}`),/immutable/);
}
assert.throws(()=>f.sql.exec("UPDATE purchase_order_drafts SET status='reviewed',revision=revision+1"),/immutable/);
await assert.rejects(po.get('a',first.snapshot.id,0),fail('invalid_request'));await assert.rejects(po.get('a',first.snapshot.id,999),fail('missing'));
assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);

// Upgrade real foundation-shaped data without modifying any existing row/receipt.
const migration=entries.find(e=>e.tag.endsWith('_purchase_order_draft_review'));
const old=new DatabaseSync(':memory:');old.exec('PRAGMA foreign_keys=ON');
for(const e of entries.filter(e=>e.idx<migration.idx))old.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
old.exec("INSERT INTO companies VALUES('a','Legacy cafe','2026-01-01'); INSERT INTO memberships VALUES('manager','a','manager')");
const legacySnapshot=JSON.stringify(first.snapshot);
old.prepare('INSERT INTO purchase_order_drafts VALUES(?,?,?,?,?,?,?,?)').run('a',first.snapshot.id,first.snapshot.number,supplier.id,'draft',1,legacySnapshot,first.snapshot.createdAt);
old.prepare('INSERT INTO purchase_order_draft_operations VALUES(?,?,?,?,?,1)').run('a','legacy-create',first.snapshot.id,JSON.stringify({actor:'manager'}),JSON.stringify(first));
old.prepare('INSERT INTO purchase_order_draft_events VALUES(?,?,?,?,?,?,?,?)').run('a',first.snapshot.id,1,'legacy-create','create','manager',first.events[0].reason,first.events[0].at);
const oldCancel={...first,status:'canceled',revision:2,events:[...first.events,{revision:2,kind:'cancel',actor:'manager',reason:'Legacy canceled',at:clock.now().toISOString()}]};
old.prepare('INSERT INTO purchase_order_draft_operations VALUES(?,?,?,?,?,1)').run('a','legacy-cancel',first.snapshot.id,'legacy-cancel-fingerprint',JSON.stringify(oldCancel));
old.prepare("UPDATE purchase_order_drafts SET status='canceled',revision=2 WHERE id=?").run(first.snapshot.id);
old.prepare('INSERT INTO purchase_order_draft_events VALUES(?,?,?,?,?,?,?,?)').run('a',first.snapshot.id,2,'legacy-cancel','cancel','manager','Legacy canceled',clock.now().toISOString());
const oldTables=()=>JSON.stringify(old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='purchase_order_draft_revisions' ORDER BY name").all().map(({name})=>[name,old.prepare(`SELECT * FROM "${name}"`).all()]));
const oldStore=new D1PurchaseOrderDrafts(new LocalD1(old),options),legacyActive=await oldStore.create(create());
const legacy=oldTables();old.exec(readFileSync(`drizzle/${migration.tag}.sql`,'utf8'));assert.equal(oldTables(),legacy);
const upgraded=new D1PurchaseOrderDrafts(new LocalD1(old),options);
assert.deepEqual(await upgraded.get('a',first.snapshot.id,1),first);assert.deepEqual(await upgraded.get('a',first.snapshot.id),oldCancel);
assert.equal((await upgraded.edit(edit(legacyActive))).revision,2);
assert.deepEqual(await upgraded.get('a',legacyActive.snapshot.id,1),legacyActive);
assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(),[]);old.close();f.sql.close();
console.log('PASS: audited edit/review/invalidation/history, exact source protections, isolated immutable upgrade, actor-bound replay/lost responses, atomic concurrency/revocation/source races and unchanged purchasing/inventory effects.');
