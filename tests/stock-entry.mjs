import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/d1-inventory-management.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/stock-entry-test.mjs'});
const {D1InventoryManagementService}=await import('../.sites-runtime/stock-entry-test.mjs');
class Statement{
  constructor(database,query,values=[]){this.database=database;this.query=query;this.values=values;}
  bind(...values){return new Statement(this.database,this.query,values);}
  async first(){return this.database.prepare(this.query).get(...this.values)??null;}
  async all(){return {success:true,results:this.database.prepare(this.query).all(...this.values),meta:{changes:0}};}
  runSync(){const statement=this.database.prepare(this.query);if(/^\s*SELECT\b/i.test(this.query))return {success:true,results:statement.all(...this.values),meta:{changes:0}};const result=statement.run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
  async run(){return this.runSync();}
}
class Database{
  constructor(sql){this.sql=sql;}
  prepare(query){return new Statement(this.sql,query);}
  async batch(statements){
    this.sql.exec('BEGIN IMMEDIATE');
    try{
      const results=statements.map(statement=>statement.runSync());
      this.sql.exec('COMMIT');
      return results;
    }catch(error){
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
}



const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const e of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
for(const id of ['a','b'])sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(id,id,'2026-01-01');
const db=new Database(sql),service=new D1InventoryManagementService(db,{clock:{now:()=>new Date('2026-04-01T00:00:00Z')}});
const input={companyId:'a',actor:'manager',productId:'croissant',operationId:'opening',name:'Croissants',stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'box',purchaseAmount:'6',openingAmount:'12',effectiveAt:'2026-01-01T00:00:00Z'};
assert.deepEqual(await service.createStock(input),{productId:'croissant'});
assert.deepEqual(await service.createStock(input),{productId:'croissant'});
const product=JSON.parse(sql.prepare("SELECT data FROM products WHERE owner='a'").get().data);assert.equal(product.priceKnown,false);assert.equal(product.supplier,'');assert.equal(product.sku,'');
assert.equal(sql.prepare('SELECT count(*) n FROM inventory_reconciliations').get().n,1);
assert.equal((await service.read('a')).records[0].onHand.minor,'12');
await assert.rejects(service.createStock({...input,name:'Different'}),e=>e.code==='operation_conflict');
await assert.rejects(service.createStock({...input,operationId:'same-product'}),e=>e.code==='operation_conflict');
const received=await service.recordMovement({companyId:'a',productId:'croissant',operationId:'receive',expectedVersion:1,actor:'manager',action:'receive',amount:'6',unitId:'each',effectiveAt:'2026-02-01T00:00:00Z',note:''});assert.equal(received.onHand.minor,'18');
const count=await service.recordCount({companyId:'a',productId:'croissant',operationId:'physical',expectedVersion:2,actor:'manager',amount:'8',unitId:'each',effectiveAt:'2026-03-01T00:00:00Z',note:''});assert.equal(count.onHand.minor,'8');
await service.createStock(input);assert.equal((await service.read('a')).records[0].onHand.minor,'8','Opening save replay cannot overwrite later stock.');
assert.deepEqual((await service.read('b')).records,[]);
const batch=db.batch.bind(db);db.batch=async s=>{await batch(s);throw Error('lost acknowledgement');};
assert.deepEqual(await service.createStock({...input,operationId:'milk-open',productId:'milk',name:'Milk',stockUnit:{kind:'curated',id:'L'},openingAmount:'2',purchaseAmount:'1'}),{productId:'milk'});db.batch=batch;
assert.equal((await service.read('a')).records.find(r=>r.productId==='milk').onHand.minor,'2000000000');
sql.exec("CREATE TRIGGER injected_stock_fail BEFORE INSERT ON inventory_reconciliations WHEN NEW.product_id='rollback' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
await assert.rejects(service.createStock({...input,operationId:'rollback-open',productId:'rollback',name:'Failed item'}),/injected failure/);
for(const [table,column] of [['products','id'],['inventory_balances_exact','product_id'],['product_unit_versions','product_id'],['inventory_config_versions','product_id']])assert.equal(sql.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}='rollback'`).get().n,0);
assert.equal(sql.prepare("SELECT count(*) n FROM inventory_setup_operations WHERE operation_id='rollback-open'").get().n,0);
const race={...input,operationId:'race',productId:'race',name:'Race'};const both=await Promise.all([service.createStock(race),service.createStock(race)]);assert.deepEqual(both,[{productId:'race'},{productId:'race'}]);assert.equal(sql.prepare("SELECT count(*) n FROM inventory_reconciliations WHERE product_id='race'").get().n,1);
await assert.rejects(service.recordMovement({companyId:'b',productId:'croissant',operationId:'foreign',expectedVersion:3,actor:'manager',action:'receive',amount:'1',unitId:'each',effectiveAt:'2026-03-02T00:00:00Z',note:''}),e=>e.code==='not_found');
console.log('Stock entry: atomic catalog/unit/pack/count, receiving versus counts, retries, races, rollback, unknown price, and company isolation passed.');
