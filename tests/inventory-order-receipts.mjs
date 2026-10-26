import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';

await build({stdin:{contents:"export * from './src/lib/d1-inventory-management.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/inventory-order-receipts-tests.mjs'});
const {D1InventoryManagementService}=await import('../.sites-runtime/inventory-order-receipts-tests.mjs');
class Statement{
  constructor(db,query,values=[]){Object.assign(this,{db,query,values});}
  bind(...values){return new Statement(this.db,this.query,values);}
  async first(){return this.db.sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {results:this.db.sql.prepare(this.query).all(...this.values)};}
  runSync(){const r=this.db.sql.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(r.changes)}};}
  async run(){return this.runSync();}
}
class Database{
  constructor(sql){this.sql=sql;}
  prepare(query){return new Statement(this,query);}
  async batch(statements){
    this.sql.exec('BEGIN IMMEDIATE');let results;
    try{results=statements.map(s=>s.runSync());this.sql.exec('COMMIT');}catch(error){this.sql.exec('ROLLBACK');throw error;}
    return results;
  }
}
const confirmedAt='2026-03-01T00:00:00.000Z',actor='manager@example.test';
async function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const {tag} of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
  for(const company of ['a','b']){
    sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,company,confirmedAt);
    for(const product of ['beans','milk','cups'])sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,product,JSON.stringify({id:product}));
  }
  const clock={at:confirmedAt},db=new Database(sql),service=new D1InventoryManagementService(db,{clock:{now:()=>new Date(clock.at)}});
  for(const [productId,id] of [['beans','each'],['cups','each'],['milk','mL']])
    await service.configure({companyId:'a',productId,operationId:'config-'+productId,actor,stockUnit:{kind:'curated',id},purchaseUnitLabel:'pack',purchaseAmount:'10',openingAmount:'5',effectiveAt:'2026-01-01T00:00:00Z'});
  const balance=productId=>({...sql.prepare('SELECT config_id,dimension,on_hand_minor,incoming_minor,version FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get('a',productId)});
  const legacy=productId=>JSON.parse(sql.prepare('SELECT data FROM inventory WHERE company_id=? AND product_id=?').get('a',productId).data);
  const manual=(productId,amount)=>service.recordMovement({companyId:'a',productId,operationId:'incoming-'+productId+'-'+amount,expectedVersion:balance(productId).version,
    actor,action:'incoming',amount,unitId:'each',effectiveAt:'2026-02-01T00:00:00Z',note:'Manual expected delivery'});
  const snapshot=()=>JSON.stringify(['inventory_balances_exact','inventory','inventory_events_exact','inventory_order_incoming','inventory_order_receipts'].map(t=>sql.prepare(`SELECT * FROM ${t} ORDER BY 1,2,3`).all()));
  const line=(productId,lineId,quantityMinor)=>({lineId,productId,configId:balance(productId).config_id,dimension:balance(productId).dimension,quantityMinor});
  const confirm=async(confirmationId,lines)=>db.batch(await service.orderIncomingStatements({companyId:'a',actor,confirmationId,lines}));
  const r=(lineId,acceptedMinor,releasedMinor='0',excessMinor='0')=>({lineId,acceptedMinor,releasedMinor,excessMinor});
  const statements=(receiptId,lines,{confirmationId='conf-1',deliveredAt='2026-03-02T08:00:00.000Z',companyId='a'}={})=>
    service.orderReceiptStatements({companyId,confirmationId,receiptId,actor,deliveredAt,lines});
  const post=async(...args)=>db.batch(await statements(...args));
  const owedLine=async(lineId,confirmationId='conf-1')=>(await service.orderIncoming('a',confirmationId)).find(x=>x.lineId===lineId);
  return {sql,db,service,clock,balance,legacy,manual,snapshot,line,confirm,r,statements,post,owedLine};
}
const approve='2026-03-02T09:00:00.000Z';

// Partial deliveries move only accepted amounts from incoming into stock, across products, beside other incoming.
{
  const f=await fixture();await f.manual('beans','3');
  await f.confirm('conf-1',[f.line('beans','l1','4'),f.line('beans','l2','2'),f.line('milk','l3','250000000')]);
  await f.confirm('conf-other',[f.line('beans','o1','5')]);
  f.clock.at=approve;const before={beans:f.balance('beans'),milk:f.balance('milk')},milkLegacy=f.legacy('milk');
  assert.equal(before.beans.incoming_minor,'14','Manual 3 + this order 6 + another order 5');
  await f.post('rcpt-1',[f.r('l1','3'),f.r('l3','100000000')]);
  assert.deepEqual([f.balance('beans').on_hand_minor,f.balance('beans').incoming_minor,f.balance('beans').version],['8','11',before.beans.version+1]);
  assert.equal(BigInt(f.balance('milk').on_hand_minor)-BigInt(before.milk.on_hand_minor),100000000n,'100 mL in exact minors');
  assert.equal(BigInt(before.milk.incoming_minor)-BigInt(f.balance('milk').incoming_minor),100000000n);
  assert.deepEqual([f.legacy('beans').onHand,f.legacy('beans').incoming],[8,11]);
  assert.deepEqual([f.legacy('milk').onHand-milkLegacy.onHand,milkLegacy.incoming-f.legacy('milk').incoming],[100,100]);
  assert.deepEqual([(await f.owedLine('l1')).receivedMinor,(await f.owedLine('l2')).receivedMinor,(await f.owedLine('l3')).receivedMinor],['3','0','100000000']);
  assert.equal(await f.service.orderIncomingOwed('a','beans'),8n,'1 + 2 still owed here, 5 on the other order');
  const events=f.sql.prepare("SELECT id,product_id,quantity_minor,effective_at,recorded_at,note FROM inventory_events_exact WHERE action='order_receipt' ORDER BY product_id").all().map(x=>({...x}));
  assert.deepEqual(events,[{id:'order-receipt:rcpt-1:beans',product_id:'beans',quantity_minor:'3',effective_at:'2026-03-02T08:00:00.000Z',recorded_at:approve,note:'Received supplier order'},
    {id:'order-receipt:rcpt-1:milk',product_id:'milk',quantity_minor:'100000000',effective_at:'2026-03-02T08:00:00.000Z',recorded_at:approve,note:'Received supplier order'}]);
  assert.deepEqual((await f.service.orderReceipts('a','conf-1')).map(x=>[x.receiptId,x.lineId,x.productId,x.acceptedMinor,x.stockAdded]),
    [['rcpt-1','l1','beans','3',true],['rcpt-1','l3','milk','100000000',true]]);
  // Exactly once: the same receipt cannot post again with any lines, and nothing changes.
  const saved=f.snapshot();
  for(const lines of [[f.r('l1','1')],[f.r('l2','1')]])await assert.rejects(f.post('rcpt-1',lines),e=>e.code==='operation_conflict');
  assert.equal(f.snapshot(),saved);
  // Two prepared postings of one receipt: the second aborts inside its batch.
  const first=await f.statements('rcpt-race',[f.r('l2','1')]),second=await f.statements('rcpt-race',[f.r('l3','1')]);
  await f.db.batch(first);const raced=f.snapshot();await assert.rejects(f.db.batch(second));assert.equal(f.snapshot(),raced);
  // A later delivery completes the line; the other order and manual incoming are untouched.
  await f.post('rcpt-2',[f.r('l1','1'),f.r('l2','1')]);
  assert.deepEqual([f.balance('beans').on_hand_minor,f.balance('beans').incoming_minor],['11','8']);
  assert.equal(await f.service.orderIncomingOwed('a','beans'),5n,'Only the other order still owes');
  await assert.rejects(f.post('rcpt-3',[f.r('l1','1')]),e=>e.code==='invalid_quantity','A completed line cannot receive more');
}
// Won't arrive: released amounts leave incoming without adding stock and close the remainder.
{
  const f=await fixture();await f.confirm('conf-1',[f.line('cups','l1','10')]);f.clock.at=approve;
  await f.post('rcpt-1',[f.r('l1','6','4')]);
  assert.deepEqual([f.balance('cups').on_hand_minor,f.balance('cups').incoming_minor],['11','0']);
  assert.deepEqual([(await f.owedLine('l1')).receivedMinor,(await f.owedLine('l1')).releasedMinor],['6','4']);
  assert.equal(await f.service.orderIncomingOwed('a','cups'),0n);
  await assert.rejects(f.post('rcpt-2',[f.r('l1','1')]),e=>e.code==='invalid_quantity');
  // Release on its own is a valid receipt line, for a supplier who says nothing more is coming.
  await f.confirm('conf-2',[f.line('cups','l1','3')]);await f.post('rcpt-3',[f.r('l1','0','3')],{confirmationId:'conf-2'});
  assert.deepEqual([f.balance('cups').on_hand_minor,f.balance('cups').incoming_minor],['11','0']);
  assert.equal(f.sql.prepare("SELECT quantity_minor FROM inventory_events_exact WHERE id='order-receipt:rcpt-3:cups'").get().quantity_minor,'0');
}
// Excess is stock beyond the order, allowed only when the receipt completes the line and releases nothing.
{
  const f=await fixture();await f.confirm('conf-1',[f.line('cups','l1','4'),f.line('beans','l2','4')]);f.clock.at=approve;
  for(const lines of [[f.r('l1','3','0','1')],[f.r('l1','3','1','1')],[f.r('l1','5')]])
    await assert.rejects(f.post('rcpt-x',lines),e=>e.code==='invalid_quantity',JSON.stringify(lines));
  await f.post('rcpt-1',[f.r('l1','4','0','2')]);
  assert.deepEqual([f.balance('cups').on_hand_minor,f.balance('cups').incoming_minor],['11','0'],'4 owed plus 2 excess into stock');
  // After a line is complete, extra stock of that product needs a normal stock entry, not this order.
  await assert.rejects(f.post('rcpt-2',[f.r('l1','0','0','1')]),e=>e.code==='invalid_quantity');
}
// Count cutoff: a physical count after the delivery already included it, so approval adds no stock again.
{
  const f=await fixture();await f.confirm('conf-1',[f.line('beans','l1','4'),f.line('cups','l2','4')]);
  f.clock.at='2026-03-02T12:00:00.000Z';
  await f.service.recordCount({companyId:'a',productId:'beans',operationId:'count-1',expectedVersion:f.balance('beans').version,actor,amount:'9',unitId:'each',effectiveAt:'2026-03-02T10:00:00.000Z',note:'Includes the delivery'});
  await f.service.recordCount({companyId:'a',productId:'cups',operationId:'count-2',expectedVersion:f.balance('cups').version,actor,amount:'5',unitId:'each',effectiveAt:'2026-03-02T06:00:00.000Z',note:'Before the delivery'});
  f.clock.at='2026-03-02T13:00:00.000Z';
  await f.post('rcpt-1',[f.r('l1','4'),f.r('l2','4')]);
  assert.deepEqual([f.balance('beans').on_hand_minor,f.balance('beans').incoming_minor],['9','0'],'Counted delivery: incoming drops, stock stays at the count');
  assert.deepEqual([f.balance('cups').on_hand_minor,f.balance('cups').incoming_minor],['9','0'],'Delivery after the count is added');
  assert.deepEqual((await f.service.orderReceipts('a','conf-1')).map(x=>[x.productId,x.stockAdded]),[['beans',false],['cups',true]]);
  const beans=f.sql.prepare("SELECT quantity_minor,effective_at,note FROM inventory_events_exact WHERE id='order-receipt:rcpt-1:beans'").get();
  assert.deepEqual({...beans},{quantity_minor:'0',effective_at:'2026-03-02T13:00:00.000Z',note:'Received supplier order; already included in the physical count at 2026-03-02T10:00:00.000Z'});
  assert.equal(f.sql.prepare("SELECT effective_at FROM inventory_events_exact WHERE id='order-receipt:rcpt-1:cups'").get().effective_at,'2026-03-02T08:00:00.000Z');
  // A count recorded later than the approval time itself refuses the posting.
  f.clock.at='2026-03-02T13:30:00.000Z';await f.confirm('conf-2',[f.line('cups','l1','1')]);
  f.clock.at='2026-03-02T14:00:00.000Z';
  await f.service.recordCount({companyId:'a',productId:'cups',operationId:'count-3',expectedVersion:f.balance('cups').version,actor,amount:'9',unitId:'each',effectiveAt:'2026-03-02T14:00:00.000Z',note:'Same time'});
  await assert.rejects(f.statements('rcpt-2',[f.r('l1','1')],{confirmationId:'conf-2'}),e=>e.code==='before_count_cutoff');
}
// All or nothing: stale balances, mirrors, lines, counts or a failing caller statement abort every product.
for(const fault of ['balance','exact-only','legacy','line','line-only','count','caller']){
  const f=await fixture();await f.confirm('conf-1',[f.line('beans','l1','4'),f.line('cups','l2','4'),f.line('cups','l3','4')]);f.clock.at=approve;
  const prepared=await f.statements('rcpt-1',[f.r('l1','2'),f.r('l2','2')]);
  if(fault==='balance')await f.manual('cups','20');
  if(fault==='exact-only')f.sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='cups'").run();
  if(fault==='legacy')f.sql.prepare("UPDATE inventory SET version=version+1,data=json_set(data,'$.version',json_extract(data,'$.version')+1) WHERE company_id='a' AND product_id='cups'").run();
  if(fault==='line')await f.post('rcpt-other',[f.r('l2','1')],{deliveredAt:'2026-03-02T07:00:00.000Z'});
  // A ledger writer that changes only the order line, leaving every balance alone.
  if(fault==='line-only')f.sql.exec(`INSERT INTO inventory_order_receipts VALUES('a','raw','conf-1','l2','cups','1','0','0',1,'2026-03-02T07:00:00.000Z','order-receipt:raw:cups','${actor}','${approve}')`);
  if(fault==='count'){f.clock.at='2026-03-02T10:00:00.000Z';await f.service.recordCount({companyId:'a',productId:'beans',operationId:'count-b',expectedVersion:f.balance('beans').version,actor,amount:'7',unitId:'each',effectiveAt:'2026-03-02T09:30:00.000Z',note:'Recount'});}
  const saved=f.snapshot();
  await assert.rejects(f.db.batch([...prepared,...(fault==='caller'?[f.db.prepare("INSERT INTO inventory_port_guards(reason) VALUES ('caller')")]:[])]),fault);
  assert.equal(f.snapshot(),saved,'Nothing applied after a '+fault+' fault');
}
// Refusals before any statement.
{
  const f=await fixture();await f.confirm('conf-1',[f.line('beans','l1','4')]);f.clock.at=approve;const ok=f.r('l1','1');
  for(const lines of [[],[f.r('l1','0')],[{...ok,acceptedMinor:'01'}],[{...ok,acceptedMinor:'-1'}],[{...ok,acceptedMinor:'1.5'}],[{...ok,releasedMinor:''}],
    [{...ok,excessMinor:'1'.repeat(19)}],[ok,{...ok}],[{...ok,lineId:''}],[f.r('missing','1')]])
    await assert.rejects(f.statements('rcpt-x',lines),e=>e.code==='invalid_input',JSON.stringify(lines));
  await assert.rejects(f.statements('rcpt-x',[ok],{deliveredAt:'2026-03-03T00:00:00.000Z'}),e=>e.code==='invalid_time','A delivery cannot be in the future');
  await assert.rejects(f.statements('rcpt-x',[ok],{deliveredAt:'yesterday'}),e=>e.code==='invalid_time');
  await assert.rejects(f.statements('rcpt-x',[ok],{confirmationId:'conf-unknown'}),e=>e.code==='invalid_input');
  await assert.rejects(f.statements('rcpt-x',[ok],{companyId:'b'}),e=>e.code==='invalid_input','Another company cannot see this order');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM inventory_order_receipts').get().n,0);
}
// The database keeps the ledger and the order lines in agreement, whatever writes it.
{
  const f=await fixture();await f.confirm('conf-1',[f.line('beans','l1','4'),f.line('beans','l2','4')]);f.clock.at=approve;await f.post('rcpt-1',[f.r('l1','2')]);
  const row=(id,line,a,rel,x,{stock=1,delivered='2026-03-02T08:00:00.000Z',created=approve,event=`order-receipt:${id}:beans`,product='beans'}={})=>
    `INSERT INTO inventory_order_receipts VALUES('a','${id}','conf-1','${line}','${product}','${a}','${rel}','${x}',${stock},'${delivered}','${event}','${actor}','${created}')`;
  for(const sql of [row('raw','l2','0','0','0'),row('raw','l2','01','0','0'),row('raw','l2','1.0','0','0'),row('raw','l2','-1','0','0'),row('raw','l2','5','0','0'),
    row('raw','l1','2','1','0'),row('raw','l2','3','0','1'),row('raw','l2','4','0','1',{product:'cups',event:'order-receipt:raw:cups'}),row('raw','l2','1','0','0',{stock:2}),
    row('raw','l2','1','0','0',{stock:"'yes'"}),row('raw','l2','1','0','0',{delivered:'2026-03-02T10:00:00.000Z'}),row('raw','l2','1','0','0',{created:'2026-03-02 09:00'}),
    row('raw','l2','1','0','0',{event:'order-receipt:other:beans'}),row('raw','l9','1','0','0'),
    "UPDATE inventory_order_receipts SET accepted_minor='1'","DELETE FROM inventory_order_receipts",
    "UPDATE inventory_order_incoming SET received_minor='3' WHERE line_id='l1'","UPDATE inventory_order_incoming SET released_minor='1' WHERE line_id='l1'",
    "UPDATE inventory_order_incoming SET received_minor='02' WHERE line_id='l1'",
    "UPDATE inventory_balances_exact SET incoming_minor='5' WHERE company_id='a' AND product_id='beans'"])
    assert.throws(()=>f.sql.exec(sql),/Invalid order receipt|permanent|immutable except through approved receipts|Incoming cannot drop|FOREIGN KEY/,sql);
  // The receipt rule itself refuses over-receiving, before the order line's own limit is reached.
  for(const sql of [row('raw','l2','5','0','0'),row('raw','l2','3','2','0'),row('raw','l1','2','1','0')])assert.throws(()=>f.sql.exec(sql),/Invalid order receipt/,sql);
  // A valid raw ledger row grows the line itself, so the totals and ledger agree.
  f.sql.exec(row('raw','l2','1','3','0'));
  assert.deepEqual([(await f.owedLine('l2')).receivedMinor,(await f.owedLine('l2')).releasedMinor],['1','3']);
  assert.equal(await f.service.orderIncomingOwed('a','beans'),2n,'Owed is confirmed minus received minus released');
  f.sql.exec("UPDATE inventory_balances_exact SET incoming_minor='2' WHERE company_id='a' AND product_id='beans'");
  assert.throws(()=>f.sql.exec("UPDATE inventory_balances_exact SET incoming_minor='1' WHERE company_id='a' AND product_id='beans'"),/Incoming cannot drop/);
  // Manual receiving keeps what orders still owe after released amounts are excluded.
  await f.manual('beans','6');
  await f.service.recordMovement({companyId:'a',productId:'beans',operationId:'receive-1',expectedVersion:f.balance('beans').version,actor,action:'receive',amount:'6',unitId:'each',effectiveAt:approve,note:'Delivery',fromIncoming:true});
  assert.equal(f.balance('beans').incoming_minor,'2');
}
console.log('PASS: order receipt posting moves accepted amounts from order-linked incoming into stock exactly once, releases what will not arrive, allows excess only on completion, skips stock already in a later physical count, aborts all-or-nothing, and the database keeps the receipt ledger and order lines in agreement.');
