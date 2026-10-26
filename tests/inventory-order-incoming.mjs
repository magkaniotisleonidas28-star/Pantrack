import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

await build({stdin:{contents:"export * from './src/lib/d1-inventory-management.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/inventory-order-incoming-tests.mjs'});
const {D1InventoryManagementService}=await import('../.sites-runtime/inventory-order-incoming-tests.mjs');
class Statement{
  constructor(db,query,values=[]){Object.assign(this,{db,query,values});}
  bind(...values){return new Statement(this.db,this.query,values);}
  async first(){return this.db.sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {results:this.db.sql.prepare(this.query).all(...this.values)};}
  runSync(){const r=this.db.sql.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(r.changes)}};}
  async run(){return this.runSync();}
}
class Database{
  constructor(sql){this.sql=sql;this.beforeBatch=null;}
  prepare(query){return new Statement(this,query);}
  async batch(statements){
    if(this.beforeBatch){const action=this.beforeBatch;this.beforeBatch=null;action();}
    this.sql.exec('BEGIN IMMEDIATE');let results;
    try{results=statements.map(s=>s.runSync());this.sql.exec('COMMIT');}catch(error){this.sql.exec('ROLLBACK');throw error;}
    return results;
  }
}
const now='2026-03-01T00:00:00.000Z',actor='manager@example.test';
async function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const {tag} of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
  for(const company of ['a','b']){
    sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,company,now);
    for(const product of ['beans','milk','cups'])sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,product,JSON.stringify({id:product}));
  }
  const db=new Database(sql),service=new D1InventoryManagementService(db,{clock:{now:()=>new Date(now)}});
  for(const [productId,id] of [['beans','each'],['cups','each'],['milk','mL']])
    await service.configure({companyId:'a',productId,operationId:'config-'+productId,actor,stockUnit:{kind:'curated',id},purchaseUnitLabel:'pack',purchaseAmount:'10',openingAmount:'5',effectiveAt:'2026-01-01T00:00:00Z'});
  const balance=productId=>sql.prepare('SELECT config_id,dimension,incoming_minor,version FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get('a',productId);
  const legacy=productId=>JSON.parse(sql.prepare('SELECT data FROM inventory WHERE company_id=? AND product_id=?').get('a',productId).data);
  let serial=0;const incoming=(productId,amount,unitId='each',op='incoming-'+productId+'-'+(++serial))=>service.recordMovement({companyId:'a',productId,operationId:op,expectedVersion:balance(productId).version,
    actor,action:'incoming',amount,unitId,effectiveAt:'2026-02-01T00:00:00Z',note:'Manual expected delivery'});
  const snapshot=()=>JSON.stringify(['inventory_balances_exact','inventory','inventory_events_exact','inventory_order_incoming'].map(t=>sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()));
  const line=(productId,lineId,quantityMinor,extra={})=>({lineId,productId,configId:balance(productId).config_id,dimension:balance(productId).dimension,quantityMinor,...extra});
  const apply=async(input,extra=[])=>db.batch([...await service.orderIncomingStatements({companyId:'a',actor,...input}),...extra]);
  return {sql,db,service,balance,legacy,incoming,snapshot,line,apply};
}

// Adds each confirmed line once, across products, beside manual incoming; legacy mirror and events follow.
{
  const f=await fixture();await f.incoming('beans','3');
  const before={beans:f.balance('beans'),milk:f.balance('milk')},milkLegacy=f.legacy('milk').incoming;
  await f.apply({confirmationId:'conf-1',lines:[f.line('beans','l1','4'),f.line('beans','l2','2'),f.line('milk','l3','250000000')]});
  assert.equal(f.balance('beans').incoming_minor,'9','Manual 3 plus confirmed 6');assert.equal(f.balance('beans').version,before.beans.version+1);
  assert.equal(BigInt(f.balance('milk').incoming_minor)-BigInt(before.milk.incoming_minor),250000000n,'250 mL in exact minors');
  assert.equal(f.legacy('beans').incoming,9);assert.equal(f.legacy('milk').incoming-milkLegacy,250,'The legacy mirror shows 250 mL more');
  assert.deepEqual((await f.service.orderIncoming('a','conf-1')).map(r=>[r.lineId,r.productId,r.quantityMinor,r.receivedMinor]),
    [['l1','beans','4','0'],['l2','beans','2','0'],['l3','milk','250000000','0']]);
  const events=f.sql.prepare("SELECT product_id,action,quantity_minor,balance_version_before,balance_version_after FROM inventory_events_exact WHERE action='order_incoming' ORDER BY product_id").all().map(r=>({...r}));
  assert.deepEqual(events,[{product_id:'beans',action:'order_incoming',quantity_minor:'6',balance_version_before:before.beans.version,balance_version_after:before.beans.version+1},
    {product_id:'milk',action:'order_incoming',quantity_minor:'250000000',balance_version_before:before.milk.version,balance_version_after:before.milk.version+1}]);
  assert.equal(await f.service.orderIncomingOwed('a','beans'),6n);
  // Exactly once: the same confirmation cannot be applied again, and nothing changes.
  const saved=f.snapshot();
  for(const lines of [[f.line('beans','l1','4')],[f.line('cups','l9','1')]])
    await assert.rejects(f.apply({confirmationId:'conf-1',lines}),e=>e.code==='operation_conflict','A confirmation applies once, whatever its lines');
  assert.equal(f.snapshot(),saved);
  // Two prepared applications of one confirmation: the second aborts inside its batch.
  const first=await f.service.orderIncomingStatements({companyId:'a',actor,confirmationId:'conf-race',lines:[f.line('cups','l1','1')]});
  const second=await f.service.orderIncomingStatements({companyId:'a',actor,confirmationId:'conf-race',lines:[f.line('beans','l1','1')]});
  await f.db.batch(first);const raced=f.snapshot();await assert.rejects(f.db.batch(second));assert.equal(f.snapshot(),raced);
  // A second confirmation adds on top; it never replaces earlier order or manual incoming.
  await f.apply({confirmationId:'conf-2',lines:[f.line('beans','l1','5')]});assert.equal(f.balance('beans').incoming_minor,'14');assert.equal(await f.service.orderIncomingOwed('a','beans'),11n);
}
// All or nothing: a stale product, a stale legacy mirror or a failing caller statement aborts every product.
for(const fault of ['balance','exact-only','legacy','caller','count']){
  const f=await fixture();const statements=await f.service.orderIncomingStatements({companyId:'a',actor,confirmationId:'conf-x',lines:[f.line('beans','l1','4'),f.line('cups','l2','1')]});
  if(fault==='balance')await f.incoming('cups','2');
  // A writer that changes only the exact balance, leaving the legacy mirror alone.
  if(fault==='exact-only')f.sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='cups'").run();
  if(fault==='legacy')f.sql.prepare("UPDATE inventory SET version=version+1,data=json_set(data,'$.version',json_extract(data,'$.version')+1) WHERE company_id='a' AND product_id='cups'").run();
  if(fault==='count')await f.service.recordCount({companyId:'a',productId:'beans',operationId:'count-b',expectedVersion:f.balance('beans').version,actor,amount:'7',unitId:'each',effectiveAt:'2026-02-15T00:00:00Z',note:'Recount'});
  const saved=f.snapshot();
  await assert.rejects(f.db.batch([...statements,...(fault==='caller'?[f.db.prepare("INSERT INTO inventory_port_guards(reason) VALUES ('caller')")]:[])]),fault);
  assert.equal(f.snapshot(),saved,'Nothing applied after a '+fault+' fault');
}
// Refusals before any statement: invalid input, wrong dimension, unconfigured product, count cutoff, wrong company.
{
  const f=await fixture();const ok=f.line('beans','l1','1');
  for(const lines of [[],[{...ok,quantityMinor:'0'}],[{...ok,quantityMinor:'-1'}],[{...ok,quantityMinor:'1.5'}],[{...ok,quantityMinor:'1'.repeat(19)}],[ok,{...ok}],[{...ok,lineId:''}]])
    await assert.rejects(f.service.orderIncomingStatements({companyId:'a',actor,confirmationId:'c',lines}),e=>e.code==='invalid_input');
  await assert.rejects(f.service.orderIncomingStatements({companyId:'a',actor,confirmationId:'c',lines:[{...ok,dimension:'volume'}]}),e=>e.code==='unit_incompatible');
  await assert.rejects(f.service.orderIncomingStatements({companyId:'b',actor,confirmationId:'c',lines:[ok]}),e=>['inventory_not_configured','not_found','missing_product'].includes(e.code)||/configure|product/i.test(e.message));
  await f.service.recordCount({companyId:'a',productId:'beans',operationId:'future-count',expectedVersion:f.balance('beans').version,actor,amount:'5',unitId:'each',effectiveAt:now,note:'Count at cutoff'});
  await assert.rejects(f.service.orderIncomingStatements({companyId:'a',actor,confirmationId:'c',lines:[ok]}),e=>e.code==='before_count_cutoff');
}
// Manual tools stay above what confirmed orders owe, and the database enforces the floor.
{
  const f=await fixture();await f.incoming('beans','3');await f.apply({confirmationId:'conf-1',lines:[f.line('beans','l1','4')]});
  await assert.rejects(f.incoming('beans','3'),e=>e.code==='invalid_quantity'&&/4 each still due from confirmed supplier orders/.test(e.message));
  await f.incoming('beans','4');assert.equal(f.balance('beans').incoming_minor,'4','Exactly the owed amount is allowed');
  await f.incoming('beans','6');
  await f.service.recordMovement({companyId:'a',productId:'beans',operationId:'receive-1',expectedVersion:f.balance('beans').version,actor,action:'receive',amount:'5',unitId:'each',effectiveAt:'2026-02-20T00:00:00Z',note:'Delivery',fromIncoming:true});
  assert.equal(f.balance('beans').incoming_minor,'4','A manual receipt reduces only manual incoming, never what orders still owe');
  for(const sql of ["UPDATE inventory_balances_exact SET incoming_minor='3' WHERE company_id='a' AND product_id='beans'",
    "UPDATE inventory_balances_exact SET dimension='volume' WHERE company_id='a' AND product_id='beans'",
    "DELETE FROM inventory_order_incoming","UPDATE inventory_order_incoming SET quantity_minor='1'","UPDATE inventory_order_incoming SET received_minor='5'",
    "UPDATE inventory_order_incoming SET received_minor='-1'","INSERT INTO inventory_port_guards(reason) VALUES ('x')",
    `INSERT INTO inventory_order_incoming VALUES('a','raw','l1','beans','${f.balance('beans').config_id}','count','01','0','e','${actor}','${now}')`,
    `INSERT INTO inventory_order_incoming VALUES('a','raw','l1','beans','${f.balance('beans').config_id}','volume','1','0','e','${actor}','${now}')`,
    `INSERT INTO inventory_order_incoming VALUES('a','raw','l1','beans','${f.balance('beans').config_id}','count','1','1','e','${actor}','${now}')`])
    assert.throws(()=>f.sql.exec(sql),/Incoming cannot drop|immutable|Inventory changed|Invalid order-linked/,sql);
  f.sql.exec("UPDATE inventory_order_incoming SET received_minor='1'");assert.equal(await f.service.orderIncomingOwed('a','beans'),3n,'Receiving may grow received');
  f.sql.exec("UPDATE inventory_balances_exact SET incoming_minor='3' WHERE company_id='a' AND product_id='beans'");
  assert.throws(()=>f.sql.exec("UPDATE inventory_balances_exact SET incoming_minor='2' WHERE company_id='a' AND product_id='beans'"),/Incoming cannot drop/);
}
console.log('PASS: order-linked incoming port adds confirmed lines exactly once across products beside manual incoming, aborts all-or-nothing on stale balances, mirrors, counts or caller failures, and keeps manual tools and the database above what orders owe.');
