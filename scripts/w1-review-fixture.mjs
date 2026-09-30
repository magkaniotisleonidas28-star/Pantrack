import assert from 'node:assert/strict';
import {mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const mode=process.argv[2];assert.ok(['seed','verify','role'].includes(mode),'Use seed, verify, or role owner|manager|employee.');
const directory='.sites-runtime/w1-review-state/v3/d1/miniflare-D1DatabaseObject';
const files=readdirSync(directory).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite');assert.equal(files.length,1);
const sql=new DatabaseSync(join(directory,files[0]));sql.exec('PRAGMA foreign_keys=ON');
const companyId='w1-fictional-cafe',person='local_seedy';
const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {results:[],meta:{changes:Number(result.changes)}};}};},async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
if(mode==='seed'){
 assert.equal(sql.prepare('SELECT count(*) AS n FROM companies').get().n,0,'Use a fresh isolated W1 fixture; do not overwrite review data.');
 mkdirSync('.sites-runtime',{recursive:true});await build({entryPoints:['src/lib/d1-waste.ts','src/lib/d1-inventory-management.ts'],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/w1-fixture'});
 const {D1InventoryManagementService}=await import('../.sites-runtime/w1-fixture/d1-inventory-management.js');const {D1WasteService}=await import('../.sites-runtime/w1-fixture/d1-waste.js');
 sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(companyId,'W1 fictional waste café','2026-01-01');sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(person,companyId,'owner');
 for(const [id,name,unit,opening,quantity] of [['milk','Fictional milk','mL','10000','200'],['beans','Fictional espresso beans','g','2000','18'],['cups','Fictional cups','each','100','1']]){
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(companyId,id,JSON.stringify({id,name,supplier:'Fictional supplier',sku:'W1-'+id,pack:'practice pack',unit:'pack',price:0,category:'Test only',url:'',sample:true}));
  const record=await new D1InventoryManagementService(db).configure({companyId,productId:id,operationId:'w1-config-'+id,actor:person,stockUnit:{kind:'curated',id:unit},purchaseUnitLabel:'practice pack',purchaseAmount:opening,openingAmount:opening,effectiveAt:'2026-01-01T00:00:00Z'});
  await new D1WasteService(db).saveShortcuts({companyId,productId:id,configId:record.configId,operationId:crypto.randomUUID(),expectedRevision:0,shortcuts:[{label:id==='milk'?'Small spill':id==='beans'?'One shot':'One cup',amount:quantity,unitId:unit}]},person);
 }
 console.log('PASS: isolated W1 fictional ingredients and quantity shortcuts seeded.');
}else if(mode==='role'){
 const role=process.argv[3];assert.ok(['owner','manager','employee'].includes(role));
 // Keep an inert fictional owner so ordinary ownership protections stay active.
 sql.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').run('w1-fixture-owner',companyId,'owner');
 sql.prepare('UPDATE memberships SET role=? WHERE user_id=? AND company_id=?').run(role,person,companyId);console.log('Local fictional role: '+role);
}else{
 const events=sql.prepare("SELECT product_id,entered_amount,entered_unit_id,waste_reason,actor FROM inventory_events_exact WHERE company_id=? AND action='waste'").all(companyId);
 assert.ok(events.every(e=>e.waste_reason&&e.actor===person));
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM orders WHERE owner=?').get(companyId).n,0,'Waste creates no order.');
 assert.equal(sql.prepare('SELECT count(*) AS n FROM sales_events WHERE company_id=?').get(companyId).n,0,'Waste creates no sale.');
 console.log(JSON.stringify({events,balances:sql.prepare('SELECT product_id,on_hand_minor,version FROM inventory_balances_exact WHERE company_id=?').all(companyId)}));
}
sql.close();
