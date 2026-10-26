import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {unstable_splitSqlQuery} from 'wrangler';

await build({stdin:{contents:"export * from './src/lib/d1-inventory-management.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/inventory-order-receipts-migration-tests.mjs'});
const {D1InventoryManagementService}=await import('../.sites-runtime/inventory-order-receipts-migration-tests.mjs');
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries,m=entries.find(e=>e.tag==='0039_inventory_order_receipts');
assert.ok(m,'Missing order receipts migration');
const statements=unstable_splitSqlQuery(readFileSync(`drizzle/${m.tag}.sql`,'utf8'));
for(const s of statements){
  assert.ok((s.match(/CREATE TRIGGER/g)??[]).length<=1,'Each trigger must be a separate Wrangler statement');
  if(/CREATE TRIGGER/.test(s))assert.match(s.trim(),/END;?$/,'Wrangler kept each trigger body whole');
}
assert.equal(statements.filter(s=>/CREATE TRIGGER/.test(s)).length,7);
const db=sql=>({prepare:q=>{const st=(v=[])=>({bind:(...x)=>st(x),first:async()=>sql.prepare(q).get(...v)??null,all:async()=>({results:sql.prepare(q).all(...v)}),
  runSync:()=>{const r=sql.prepare(q).run(...v);return {success:true,results:[],meta:{changes:Number(r.changes)}};},run:async()=>st(v).runSync()});return st();},
  batch:async list=>{sql.exec('BEGIN IMMEDIATE');try{const r=list.map(s=>s.runSync());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}});
const now='2026-03-01T00:00:00.000Z',later='2026-03-02T09:00:00.000Z',actor='manager@example.test';
for(const populated of [false,true]){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  try{
    for(const e of entries.filter(e=>e.idx<m.idx))sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
    const clock={at:now},d=db(sql),service=new D1InventoryManagementService(d,{clock:{now:()=>new Date(clock.at)}});
    if(populated){
      // A supplier order confirmed before the upgrade, with manual incoming beside it.
      sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run('a','a',now);sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run('a','beans','{"id":"beans"}');
      await service.configure({companyId:'a',productId:'beans',operationId:'config-beans',actor,stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'pack',purchaseAmount:'10',openingAmount:'5',effectiveAt:'2026-01-01T00:00:00Z'});
      sql.exec("UPDATE inventory_balances_exact SET incoming_minor='3' WHERE company_id='a' AND product_id='beans'");
      const b=sql.prepare("SELECT config_id,dimension FROM inventory_balances_exact WHERE product_id='beans'").get();
      await d.batch(await service.orderIncomingStatements({companyId:'a',actor,confirmationId:'conf-1',lines:[{lineId:'l1',productId:'beans',configId:b.config_id,dimension:b.dimension,quantityMinor:'4'}]}));
    }
    const tables=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
    // The new column defaults to 0 on existing order lines; every other value is unchanged.
    const snapshot=()=>JSON.stringify(tables.map(t=>[t,sql.prepare(`SELECT * FROM "${t}"`).all().map(r=>{const {released_minor,...rest}=r;
      if(t==='inventory_order_incoming')assert.equal(released_minor??'0','0');return rest;})]));
    const before=snapshot();for(const s of statements)sql.exec(s);
    assert.equal(snapshot(),before,'Every existing table is unchanged');
    assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,tables.length+1);
    if(populated){
      assert.equal(sql.prepare("SELECT released_minor FROM inventory_order_incoming").get().released_minor,'0');
      clock.at=later;
      await d.batch(await service.orderReceiptStatements({companyId:'a',confirmationId:'conf-1',receiptId:'rcpt-1',actor,deliveredAt:'2026-03-02T08:00:00.000Z',
        lines:[{lineId:'l1',acceptedMinor:'3',releasedMinor:'1',excessMinor:'0'}]}));
      const b=sql.prepare("SELECT on_hand_minor,incoming_minor FROM inventory_balances_exact WHERE product_id='beans'").get();
      assert.deepEqual([b.on_hand_minor,b.incoming_minor],['8','3'],'The pre-upgrade order is received; manual incoming stays');
    }
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{sql.close();}
}
console.log('PASS: Wrangler-split 0039 fresh/populated upgrades keep every table and existing incoming, then an order confirmed before the upgrade is received and partly released.');
