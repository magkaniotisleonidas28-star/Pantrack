import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime',{recursive:true});
await build({stdin:{contents:"export {D1InventoryManagementService} from './src/lib/d1-inventory-management';export {recordPackageStock} from './src/lib/d1-stock-pack';export {publishRecipe} from './src/lib/d1-recipe-publisher';export {D1InventoryConsumptionPort} from './src/lib/d1-inventory-consumption';export * from './src/lib/stock-pack-quantities';export * from './src/lib/inventory-quantities';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/stock-pack-tests.mjs'});
const {D1InventoryManagementService,recordPackageStock,publishRecipe,D1InventoryConsumptionPort,curatedUnit,toCanonical,formatInUnit,packageEquivalent}=await import('../.sites-runtime/stock-pack-tests.mjs');
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
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
for(const e of journal.filter(e=>e.idx<21))sql.exec(readFileSync('drizzle/'+e.tag+'.sql','utf8'));
sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run('a','Fictional A','2026-01-01');
sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run('b','Fictional B','2026-01-01');
// Populate a used configuration before the additive migration.
sql.prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)').run('a','old-beans',JSON.stringify({id:'old-beans',name:'Old beans'}));
sql.exec("INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at) VALUES('a','old-beans','g',1,'curated','mass','g','1','1','manager','2026-01-01');");
sql.exec("INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,effective_from,created_by,created_at) VALUES('a','old-beans','old-config',1,'active','g',1,'bag','1000000000','2026-01-01','manager','2026-01-01');");
sql.exec("INSERT INTO inventory_balances_exact(company_id,product_id,config_id,dimension,on_hand_minor,incoming_minor,estimated_used_minor,version,latest_count_effective_at,updated_at) VALUES('a','old-beans','old-config','mass','500000000','0','0',1,'2026-01-01','2026-01-01');");
const oldBalance=JSON.stringify(sql.prepare("SELECT * FROM inventory_balances_exact").all());
for(const e of journal.filter(e=>e.idx>=21))sql.exec(readFileSync('drizzle/'+e.tag+'.sql','utf8'));
assert.equal(JSON.stringify(sql.prepare("SELECT * FROM inventory_balances_exact").all()),oldBalance);
assert.equal(sql.prepare("SELECT purchase_entered_unit_id FROM inventory_config_versions").get().purchase_entered_unit_id,null);
const db=new Database(sql),service=new D1InventoryManagementService(db,{clock:{now:()=>new Date('2026-05-01T00:00:00Z')}});
const common={companyId:'a',actor:'manager',effectiveAt:'2026-01-01T00:00:00Z'};
for(const [id,measurement,label,contents,contentUnit] of [['milk','fl_oz_us','jug','1','gallon_us'],['syrup','mL','bottle','750','mL'],['beans','g','bag','1','kg']]){
 await service.createStock({...common,productId:id,operationId:'open-'+id,name:id,stockUnit:{kind:'curated',id:measurement},purchaseUnitLabel:label,purchaseAmount:contents,purchaseContentUnitId:contentUnit,openingPackages:{packages:'0',remainder:'0',remainderUnitId:measurement}});
}
await service.createStock({...common,productId:'spread',operationId:'open-spread',name:'Fictional spread',stockUnit:{kind:'curated',id:'g'},purchaseUnitLabel:'jar',purchaseAmount:'1000',purchaseContentUnitId:'g',openingPackages:{packages:'2',remainder:'150',remainderUnitId:'g'}});
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE product_id='spread'").get().on_hand_minor,'2150000000');
const record=async id=>(await service.read('a')).records.find(r=>r.productId===id);
const balance=id=>sql.prepare('SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get('a',id).on_hand_minor;
const entry=async(id,packages,action='receive',remainder='0')=>{
 const r=await record(id);return {...common,productId:id,operationId:crypto.randomUUID(),configId:r.configId,expectedVersion:r.version,action,quantity:{packages,remainder,remainderUnitId:r.stockUnitId},effectiveAt:'2026-01-02T00:00:00Z',note:''};
};
const milkReceive=await entry('milk','3');await recordPackageStock(db,milkReceive);
assert.equal(balance('milk'),'11356235352');assert.equal(formatInUnit((await record('milk')).onHand,curatedUnit('fl_oz_us')),'384');
await recordPackageStock(db,milkReceive);assert.equal(balance('milk'),'11356235352');
await assert.rejects(recordPackageStock(db,{...milkReceive,quantity:{...milkReceive.quantity,packages:'4'}}),e=>e.code==='operation_conflict');
await recordPackageStock(db,await entry('syrup','2'));assert.equal(balance('syrup'),'1500000000');
await recordPackageStock(db,await entry('beans','2'));assert.equal(balance('beans'),'2000000000');
for(const [id,amount,unit] of [['milk','8','fl_oz_us'],['syrup','30','mL'],['beans','18','g']]){
 await publishRecipe(db,{...common,operationId:'recipe-'+id,recipeId:'drink-'+id,versionId:'v-'+id,name:id,expectedActiveVersionId:null,expectedModifiers:{},ingredients:[{productId:id,amount,unitId:unit}],choices:[],modifiers:[]},'2026-04-01T00:00:00Z');
 const before=BigInt(balance(id)),used=BigInt(toCanonical(amount,curatedUnit(unit),{companyId:'a',productId:id}).minor);
 const port=new D1InventoryConsumptionPort(db,{clock:{now:()=>new Date('2026-05-01T00:00:00Z')}});
 const result=await port.consume({contract:'pantrack.inventory-consumption.v1',companyId:'a',idempotencyKey:'sale-'+id,occurredAt:'2026-04-02T00:00:00Z',lines:[{lineId:'line',recipeId:'drink-'+id,quantity:'1',modifiers:[]}]});
 assert.equal(result.status,'applied');assert.equal(balance(id),(before-used).toString());
}
const syrupCount={...await entry('syrup','2','count','150'),effectiveAt:'2026-04-03T00:00:00Z'};
await recordPackageStock(db,syrupCount);assert.equal(balance('syrup'),'1650000000');
await recordPackageStock(db,syrupCount);assert.equal(balance('syrup'),'1650000000');
assert.equal(packageEquivalent((await record('syrup')).onHand,(await record('syrup')).purchase.quantity),'2.2');
const milkCount={...await entry('milk','2','count','8'),effectiveAt:'2026-04-03T00:00:00Z'};
await recordPackageStock(db,milkCount);
assert.equal(formatInUnit((await record('milk')).onHand,curatedUnit('fl_oz_us')),'264');
assert.equal(JSON.parse(sql.prepare("SELECT data FROM inventory WHERE product_id='milk'").get().data).onHand,264,'Legacy projection keeps the configured recipe measurement.');
await recordPackageStock(db,milkCount);
const beforeConfig=await record('milk');
const configure={...common,productId:'milk',operationId:'new-milk-pack',expectedConfigId:beforeConfig.configId,stockUnit:{kind:'curated',id:'fl_oz_us'},purchaseUnitLabel:'half-gallon jug',purchaseAmount:'0.5',purchaseContentUnitId:'gallon_us',effectiveAt:'2026-04-04T00:00:00Z'};
await service.configure(configure);const afterEdit=balance('milk');assert.equal(afterEdit,beforeConfig.onHand.minor);
await recordPackageStock(db,milkReceive);assert.equal(balance('milk'),afterEdit,'Old delivery retry uses its original receipt, not the new package size.');
await service.configure(configure);assert.equal(balance('milk'),afterEdit);
const stale={...await entry('milk','1'),configId:beforeConfig.configId,effectiveAt:'2026-04-05T00:00:00Z'};await assert.rejects(recordPackageStock(db,stale),e=>e.code==='concurrent_update');
const receipt=JSON.parse(sql.prepare("SELECT fingerprint FROM inventory_setup_operations WHERE operation_id=?").get(milkReceive.operationId).fingerprint);assert.equal(receipt.configId,beforeConfig.configId);assert.equal(receipt.quantity.packages,'3');
assert.throws(()=>sql.exec("UPDATE inventory_config_versions SET purchase_quantity_minor='1' WHERE id='open-milk'"),/immutable/);
assert.throws(()=>sql.exec("DELETE FROM inventory_config_versions WHERE id='open-milk'"),/cannot be deleted/);
await assert.rejects(service.configure({...configure,operationId:'stale-setup',purchaseAmount:'2'}),e=>e.code==='concurrent_update');
await assert.rejects(service.createStock({...common,productId:'bad-density',operationId:'bad-density',name:'Bad density',stockUnit:{kind:'curated',id:'g'},purchaseUnitLabel:'bottle',purchaseAmount:'750',purchaseContentUnitId:'mL',openingAmount:'0'}),e=>e.code==='unit_incompatible');
assert.equal(sql.prepare("SELECT count(*) n FROM products WHERE id='bad-density'").get().n,0);
for(const qty of [{packages:'1.5',remainder:'0',remainderUnitId:'mL'},{packages:'1',remainder:'-1',remainderUnitId:'mL'},{packages:'1',remainder:'1',remainderUnitId:'g'}]){
 await assert.rejects(recordPackageStock(db,{...await entry('syrup','1'),quantity:qty,effectiveAt:'2026-04-05T00:00:00Z'}));
}
await assert.rejects(recordPackageStock(db,{...await entry('syrup','1'),companyId:'b'}),e=>e.code==='not_found');
const both=await entry('beans','1');both.effectiveAt='2026-04-05T00:00:00Z';
const beforeBoth=BigInt(balance('beans'));await Promise.all([recordPackageStock(db,both),recordPackageStock(db,both)]);assert.equal(balance('beans'),(beforeBoth+BigInt(1000000000)).toString());
const competing=await entry('beans','1');competing.effectiveAt='2026-04-06T00:00:00Z';
const results=await Promise.allSettled([recordPackageStock(db,competing),recordPackageStock(db,{...competing,operationId:crypto.randomUUID()})]);assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);
const lost={...await entry('syrup','1'),effectiveAt:'2026-04-05T00:00:00Z'};const batch=db.batch.bind(db);db.batch=async s=>{await batch(s);throw Error('lost acknowledgement');};await recordPackageStock(db,lost);db.batch=batch;
const failed={...await entry('syrup','1'),effectiveAt:'2026-04-06T00:00:00Z'};const failedBefore=balance('syrup');
sql.exec("CREATE TRIGGER injected_pack_failure BEFORE INSERT ON inventory_events_exact WHEN NEW.id='movement:"+failed.operationId+"' BEGIN SELECT RAISE(ABORT,'injected package failure'); END;");
await assert.rejects(recordPackageStock(db,failed),/injected package failure/);assert.equal(balance('syrup'),failedBefore);assert.equal(sql.prepare("SELECT count(*) n FROM inventory_setup_operations WHERE operation_id=?").get(failed.operationId).n,0);
const incoming={...await entry('beans','2','incoming','0'),effectiveAt:'2026-04-07T00:00:00Z'};await recordPackageStock(db,incoming);assert.equal((await record('beans')).incoming.minor,'2000000000');
const delivered={...await entry('beans','1'),effectiveAt:'2026-04-08T00:00:00Z',fromIncoming:true};await recordPackageStock(db,delivered);assert.equal((await record('beans')).incoming.minor,'1000000000');
await recordPackageStock(db,{...await entry('beans','0','incoming'),effectiveAt:'2026-04-09T00:00:00Z'});assert.equal((await record('beans')).incoming.minor,'0');
assert.equal((await record('old-beans')).purchase.enteredAmount,null);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('Stock packages: milk/syrup/beans consumption, counts, incoming, package edits, audited retries, races, rollback, isolation and additive compatibility passed.');
