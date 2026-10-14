import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';

await build({stdin:{contents:[
  'd1-po-cart-preparation','po-cart-preparation-contract','d1-purchase-order-drafts',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},
bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-contract-test.mjs'});
const {D1PoCartPreparation,D1PurchaseOrderDrafts,preparationPreflight,assertPreparationUnchanged} =
  await import('../.sites-runtime/po-cart-contract-test.mjs');
const f = await fixture();
try {
  await f.source({productId:'coffee'});
  const drafts = new D1PurchaseOrderDrafts(f.db,f.options);
  const create = {action:'create',source:'manual',companyId:'a',operationId:randomUUID(),
    supplier:{id:'cart-demo-supplier',name:'Fictional cart',email:'demo@example.invalid',
      accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'Fictional counter'},
    capMinor:'15000',notes:'Practice only',lines:[
      {kind:'stock',productId:'coffee',expectedConfigId:'config-coffee',expectedConfigVersion:1,
        sku:'DEMO-COFFEE',description:'Coffee',packs:'2',estimatedUnitMinor:'5400'},
      {kind:'non_stock',sku:'DEMO-CUPS',description:'Cups',unitLabel:'sleeve of 50',packs:'3',estimatedUnitMinor:'650'},
    ]};
  let order = await drafts.create(create);
  const command = {companyId:'a',orderId:order.snapshot.id,expectedRevision:order.revision,operationId:randomUUID()};
  const connection = {companyId:'a',id:'fictional-connection',version:1,supplierId:'cart-demo-supplier',
    accountId:'DEMO-CART',locationId:'DEMO-CAFE',mode:'fictional',status:'active',paused:false};
  let resolveConnection = async()=>connection;
  const service = new D1PoCartPreparation(f.db,{identity:f.options.identity,connection:c=>resolveConnection(c)});
  const code = expected=>e=>e.code===expected;
  const snapshot = ()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all().map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all().map(row=>JSON.stringify(row)).sort()]));
  const untouched = async fn=>{const before=snapshot();try{return await fn();}finally{assert.equal(snapshot(),before,'Preflight must never write database state');}};

  await untouched(()=>assert.rejects(service.inspect(command),code('source_changed')));
  order = await drafts.review({...command,action:'review',acknowledgeWarnings:true});
  command.expectedRevision = order.revision;
  for (const actor of [null,'employee','b-manager','unknown']) {
    f.setUser(actor);
    await untouched(()=>assert.rejects(service.inspect(command),code('forbidden')));
  }
  f.setUser('manager');
  await untouched(()=>assert.rejects(service.inspect({...command,companyId:'b'}),code('forbidden')));
  f.setUser('b-manager');
  await untouched(()=>assert.rejects(service.inspect({...command,companyId:'b'}),code('missing')));
  f.setUser('manager');
  for (const injected of [{actor:'owner'},{lines:create.lines},{capMinor:'99999'},
    {connection},{mode:'real'},{expectedRevision:0},{operationId:'not-a-uuid'}]) {
    await untouched(()=>assert.rejects(service.inspect({...command,...injected}),code('invalid_request')));
  }
  const input = await untouched(()=>service.inspect(command));
  assert.equal(input.authorization,'required');
  assert.equal(input.mode,'fictional');
  assert.equal(input.actor,'manager');
  assert.equal(input.capMinor,'15000');
  assert.equal(input.itemSubtotalMinor,'12750');
  assert.deepEqual(input.lines.map(l=>[l.packs,l.unitMinor,l.lineMinor]),[['2','5400','10800'],['3','650','1950']]);
  assert.deepEqual(input.lines[0].stockQuantity,{dimension:'count',minor:'60'});
  assert.equal(input.lines[1].stockQuantity,null);
  assert.ok(Object.isFrozen(input.lines[0].stockQuantity));
  assert.notEqual(input.connection,connection,'The binding must not retain a mutable server reference');
  assert.throws(()=>{input.lines[0].packs='7';},TypeError);
  assert.deepEqual(await untouched(()=>service.revalidate(command,input)),input,'Repeated preflight is deterministic, not a new grant');
  f.setUser('owner');
  assert.equal((await untouched(()=>service.inspect(command))).actor,'owner');
  await untouched(()=>assert.rejects(service.revalidate(command,input),code('source_changed')));
  f.setUser('manager');

  const changed = mutate=>{const copy=structuredClone(order);mutate(copy);return copy;};
  const preflight = (o=order,c=connection)=>preparationPreflight(command,'manager',o,c);
  const rejectsChange = mutate=>assert.throws(()=>assertPreparationUnchanged(input,preflight(changed(mutate))),code('source_changed'));
  for (const mutate of [o=>o.revision++,o=>o.status='canceled',o=>o.status='draft',
    o=>o.snapshot.supplier.id='baldor',o=>o.snapshot.supplier.accountId='OTHER',
    o=>o.snapshot.supplier.locationId='OTHER',o=>o.snapshot.currency='EUR',
    o=>o.snapshot.pricesComplete=false,o=>o.snapshot.capMinor='0',o=>o.snapshot.capMinor='100',
    o=>o.snapshot.lines[0].packs='2.5',o=>o.snapshot.lines[0].packs='02',
    o=>o.snapshot.lines[0].estimatedLineMinor=null,o=>o.snapshot.lines[0].estimatedUnitMinor=null,
    o=>o.snapshot.lines[0].estimatedLineMinor='10801',o=>o.snapshot.lines[0].stockQuantity.minor='61',
    o=>o.snapshot.lines[0].stockQuantity.dimension='mass',o=>o.snapshot.lines[0].mappingId='incomplete',
    o=>o.snapshot.lines.push(o.snapshot.lines[0]),o=>o.snapshot.lines[1].sku='DEMO-COFFEE',
    o=>o.snapshot.lines[1].productId='coffee']) rejectsChange(mutate);
  // These remain arithmetically valid but still invalidate the complete binding.
  for (const mutate of [o=>o.snapshot.capMinor='16000',o=>o.snapshot.supplier.deliveryAddress='Different counter',
    o=>o.snapshot.lines[0].sku='NEW-SKU',o=>o.snapshot.lines[0].unitLabel='new pack',
    o=>o.snapshot.lines[0].configVersion++,o=>o.snapshot.notes='new delivery instructions',
    o=>{o.snapshot.lines[0].mappingId='mapping';o.snapshot.lines[0].mappingVersion=2;},
    o=>{o.snapshot.lines[0].packs='1';o.snapshot.lines[0].stockQuantity.minor='30';
      o.snapshot.lines[0].estimatedLineMinor='5400';o.snapshot.knownSubtotalMinor='7350';},
    o=>{o.snapshot.lines[0].estimatedUnitMinor='5500';o.snapshot.lines[0].estimatedLineMinor='11000';o.snapshot.knownSubtotalMinor='12950';},
    o=>{o.snapshot.lines[0].stockUnitsPerPack.minor='31';o.snapshot.lines[0].stockQuantity.minor='62';}]) rejectsChange(mutate);
  assert.throws(()=>preflight(changed(o=>o.snapshot.companyId='b')),code('forbidden'));
  for (const patch of [{version:2},{id:'other'},{status:'disconnected'},{paused:true},
    {accountId:'other'},{locationId:'other'},{supplierId:'other'}]) {
    assert.throws(()=>assertPreparationUnchanged(input,preflight(order,{...connection,...patch})),code('source_changed'));
  }
  assert.throws(()=>preflight(order,{...connection,companyId:'b'}),code('forbidden'));
  assert.throws(()=>preflight(order,{...connection,liveViewUrl:'https://example.invalid/private'}),code('invalid_request'));
  assert.throws(()=>preflight(order,{...connection,mode:'real'}),code('real_disabled'));
  assert.throws(()=>preflight(changed(o=>{o.snapshot.source='registry';}),{...connection,mode:'real'}),code('real_disabled'));
  // Legacy total-only prices are accepted exactly, never rounded.
  const legacy=changed(o=>delete o.snapshot.lines[0].estimatedUnitMinor);
  assert.equal(preflight(legacy).lines[0].unitMinor,'5400');
  legacy.snapshot.lines[0].estimatedLineMinor='10801';legacy.snapshot.knownSubtotalMinor='12751';
  assert.throws(()=>preflight(legacy),code('source_changed'));
  const large=changed(o=>{const l=o.snapshot.lines[0];l.packs='99999999';l.stockUnitsPerPack.minor='99999999999999999999';
    l.stockQuantity.minor=String(BigInt(l.packs)*BigInt(l.stockUnitsPerPack.minor));l.estimatedUnitMinor='1';
    l.estimatedLineMinor=l.packs;o.snapshot.knownSubtotalMinor='100001949';o.snapshot.capMinor='100001950';});
  assert.equal(preflight(large).lines[0].stockQuantity.minor,'9999999899999999999900000001');

  // Saved edits invalidate the old request even when subsequently reviewed again.
  order=await drafts.edit({...create,action:'edit',orderId:command.orderId,expectedRevision:order.revision,
    operationId:randomUUID(),reason:'Changed proposed cap',capMinor:'16000'});
  await untouched(()=>assert.rejects(service.revalidate(command,input),code('source_changed')));
  order=await drafts.review({...command,expectedRevision:order.revision,action:'review',operationId:randomUUID(),acknowledgeWarnings:true});
  const currentCommand={...command,expectedRevision:order.revision};
  await untouched(()=>assert.rejects(service.revalidate(currentCommand,input),code('source_changed')));
  await untouched(()=>service.inspect(currentCommand));
  resolveConnection=async()=>{f.sql.prepare("DELETE FROM memberships WHERE company_id='a' AND user_id='manager'").run();return connection;};
  // Resolver simulates revocation during a read; only that deliberate change occurs.
  const beforeRevocation=snapshot();
  await assert.rejects(service.inspect(currentCommand),code('forbidden'));
  f.sql.prepare("INSERT INTO memberships(company_id,user_id,role) VALUES('a','manager','manager')").run();
  assert.equal(snapshot(),beforeRevocation);
  resolveConnection=async()=>{f.setUser('owner');return connection;};
  await untouched(()=>assert.rejects(service.inspect(currentCommand),code('forbidden')));
  f.setUser('manager');resolveConnection=async()=>connection;
  order=await drafts.cancel({...currentCommand,action:'cancel',operationId:randomUUID(),reason:'Practice canceled'});
  await untouched(()=>assert.rejects(service.inspect({...currentCommand,expectedRevision:order.revision}),code('source_changed')));
  console.log('PASS: exact immutable PO/cart binding, server-derived identity, company/role/revocation guards, stale inputs, real-mode denial and zero preflight writes.');
} finally {f.sql.close();}
