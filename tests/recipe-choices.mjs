import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
mkdirSync('.sites-runtime/recipe-choices',{recursive:true});
await build({entryPoints:['src/lib/d1-recipe-publisher.ts','src/lib/d1-inventory-management.ts','src/lib/d1-inventory-consumption.ts','src/lib/d1-sales-runtime.ts','src/lib/d1-menu-waste.ts'],bundle:true,platform:'node',format:'esm',outdir:'.sites-runtime/recipe-choices'});
const {publishRecipe}=await import('../.sites-runtime/recipe-choices/d1-recipe-publisher.js');
const {D1InventoryManagementService}=await import('../.sites-runtime/recipe-choices/d1-inventory-management.js');
const {D1InventoryConsumptionPort}=await import('../.sites-runtime/recipe-choices/d1-inventory-consumption.js');
const {D1MenuWasteService}=await import('../.sites-runtime/recipe-choices/d1-menu-waste.js');
const {ingestLocalSale}=await import('../.sites-runtime/recipe-choices/d1-sales-runtime.js');
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
const now='2026-04-01T00:00:00.000Z',companyId='a',actor='manager';
for(const id of ['a','b'])sql.prepare('INSERT INTO companies(id,name,created) VALUES(?,?,?)').run(id,id,now);
const db=new Database(sql),stock=new D1InventoryManagementService(db,{clock:{now:()=>new Date(now)}});
for(const [id,unit,amount] of [['milk','mL','10000'],['oat','mL','10000'],['beans','g','10000'],['cups','each','100']]){
 sql.prepare('INSERT INTO products(owner,id,data) VALUES(?,?,?)').run(companyId,id,JSON.stringify({id,name:id}));
 await stock.configure({companyId,actor,productId:id,operationId:'stock-'+id,stockUnit:{kind:'curated',id:unit},purchaseUnitLabel:'pack',purchaseAmount:'1',openingAmount:amount,effectiveAt:'2026-01-01T00:00:00Z'});
}
const input={companyId,actor,operationId:'publish1',recipeId:'latte',versionId:'v1',name:'Latte',expectedActiveVersionId:null,expectedModifiers:{},ingredients:[{productId:'beans',amount:'18',unitId:'g'},{productId:'cups',amount:'1',unitId:'each'}],choices:[{id:'milk-choice',name:'Milk choice',modifierIds:['whole','oat']}],modifiers:[{modifierId:'whole',versionId:'whole1',name:'Whole milk',deltas:[{productId:'milk',amount:'200',unitId:'mL',signed:false}]},{modifierId:'oat',versionId:'oat1',name:'Oat milk',deltas:[{productId:'oat',amount:'200',unitId:'mL',signed:false}]},{modifierId:'shot',versionId:'shot1',name:'Extra shot',deltas:[{productId:'beans',amount:'18',unitId:'g',signed:false}]}]};
await assert.rejects(publishRecipe(db,{...input,operationId:'duplicate-base',ingredients:[...input.ingredients,{productId:'milk',amount:'200',unitId:'mL'}]},now),e=>e.code==='invalid_recipe');
assert.deepEqual(await publishRecipe(db,input,now),{recipeId:'latte',versionId:'v1'});
assert.deepEqual(await publishRecipe(db,input,now),{recipeId:'latte',versionId:'v1'});
assert.equal(sql.prepare('SELECT count(*) n FROM recipe_versions').get().n,1);
await assert.rejects(publishRecipe(db,{...input,name:'Different'},now),e=>e.code==='operation_conflict');
const port=new D1InventoryConsumptionPort(db,{clock:{now:()=>new Date('2026-04-30T00:00:00Z')}});
const request=(id,mods,quantity='1')=>({contract:'pantrack.inventory-consumption.v1',companyId,idempotencyKey:id,occurredAt:'2026-04-02T00:00:00Z',lines:[{lineId:'line',recipeId:'latte',quantity,modifiers:mods.map(id=>({modifierId:id,quantity}))}]});
const balances=()=>JSON.stringify(sql.prepare('SELECT product_id,on_hand_minor FROM inventory_balances_exact ORDER BY product_id').all());
for(const mods of [[],['whole','oat']]){const before=balances(),result=await port.consume(request('held-'+mods.join('-'),mods));assert.equal(result.status,'held');assert.ok(result.issues.some(i=>i.code==='required_choice_missing'));assert.equal(balances(),before);}
const before=balances();const mismatch=request('mismatch',['whole'],'2');mismatch.lines[0].modifiers[0].quantity='1';assert.equal((await port.consume(mismatch)).status,'held');assert.equal(balances(),before);
assert.equal((await port.consume(request('whole-sale',['whole']))).status,'applied');
assert.equal(sql.prepare("SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id='milk'").get().n,'9800000000');
assert.equal(sql.prepare("SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id='oat'").get().n,'10000000000');
assert.equal((await port.consume(request('oat-extra',['oat','shot']))).status,'applied');
assert.equal(sql.prepare("SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id='oat'").get().n,'9800000000');
assert.equal(sql.prepare("SELECT on_hand_minor n FROM inventory_balances_exact WHERE product_id='beans'").get().n,'9946000000');
const after=balances();await port.consume(request('oat-extra',['oat','shot']));assert.equal(balances(),after);
await assert.rejects(stock.archiveModifier({companyId,actor,recipeId:'latte',modifierId:'whole',versionId:'whole1'}),e=>e.code==='invalid_recipe');
assert.throws(()=>sql.prepare("UPDATE recipe_version_choices SET groups_json='[]'").run(),/immutable/);
const next={...input,operationId:'publish2',versionId:'v2',expectedActiveVersionId:'v1',expectedModifiers:{whole:'whole1',oat:'oat1',shot:'shot1'},modifiers:input.modifiers.map(m=>({...m,versionId:m.modifierId+'2'}))};
const batch=db.batch.bind(db);db.batch=async statements=>{await batch(statements);throw new Error('ack lost');};
assert.deepEqual(await publishRecipe(db,next,'2026-04-03T00:00:00Z'),{recipeId:'latte',versionId:'v2'});db.batch=batch;
assert.equal(sql.prepare("SELECT count(*) n FROM recipe_versions WHERE status='active'").get().n,1);
await assert.rejects(publishRecipe(db,{...next,operationId:'stale',versionId:'stale'},'2026-04-04T00:00:00Z'),e=>e.code==='concurrent_update');
assert.equal(sql.prepare("SELECT count(*) n FROM inventory_setup_operations WHERE operation_id='stale'").get().n,0);
assert.equal((await port.consume(request('historical',['whole']))).status,'applied','Older occurrence uses the original choice and modifier versions.');
const other={...input,companyId:'b',operationId:'foreign',versionId:'foreign'};await assert.rejects(publishRecipe(db,other,now));
assert.equal(sql.prepare("SELECT count(*) n FROM recipe_versions WHERE company_id='b'").get().n,0);
const fail={...next,operationId:'rollback',versionId:'v3',expectedActiveVersionId:'v2',expectedModifiers:{whole:'whole2',oat:'oat2',shot:'shot2'},modifiers:input.modifiers.map(m=>({...m,versionId:m.modifierId+'3'}))};
sql.exec("CREATE TRIGGER injected_publish_failure BEFORE INSERT ON recipe_modifier_deltas WHEN NEW.version_id='oat3' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
await assert.rejects(publishRecipe(db,fail,'2026-04-04T00:00:00Z'),/injected failure/);
assert.equal(sql.prepare("SELECT count(*) n FROM inventory_setup_operations WHERE operation_id='rollback'").get().n,0);assert.equal(sql.prepare("SELECT count(*) n FROM recipe_versions WHERE id='v3'").get().n,0);assert.equal(sql.prepare("SELECT id FROM recipe_versions WHERE status='active'").get().id,'v2');
// Mixed milk lines stay separate in the durable manual-sales event.
const sale=await ingestLocalSale({db,companyId,source:'manual',reference:'mixed-milk',occurredAt:'2026-04-04T00:00:00Z',actor:{kind:'user',userId:'owner',companyId,role:'owner'},lines:[{recipeId:'latte',quantity:1,modifiers:[{modifierId:'whole',perItem:1}]},{recipeId:'latte',quantity:1,modifiers:[{modifierId:'oat',perItem:1}]}]});
assert.equal(sale.state,'applied');const stable=balances();await ingestLocalSale({db,companyId,source:'manual',reference:'mixed-milk',occurredAt:'2026-04-04T00:00:00Z',actor:{kind:'user',userId:'owner',companyId,role:'owner'},lines:[{recipeId:'latte',quantity:1,modifiers:[{modifierId:'whole',perItem:1}]},{recipeId:'latte',quantity:1,modifiers:[{modifierId:'oat',perItem:1}]}]});assert.equal(balances(),stable);
const menu=new D1MenuWasteService(db),item=(await menu.options(companyId,true)).items.find(i=>i.id==='latte');assert.equal(item.choices[0].name,'Milk choice');
const waste={companyId,operationId:crypto.randomUUID(),sourceKind:'recipe',sourceId:'latte',sourceVersion:'v2',quantity:1,reason:'spilled',note:'',mode:'replacement',effectiveAt:'2026-04-04T00:00:00Z',modifiers:[]};
const noMilkBefore=balances();await assert.rejects(menu.record(waste,'worker'),e=>e.code==='invalid_input'&&e.message.includes('milk choice'));assert.equal(balances(),noMilkBefore);
const oatWaste={...waste,operationId:crypto.randomUUID(),modifiers:[{id:'oat',versionId:'oat2',perItem:1}]};assert.equal((await menu.record(oatWaste,'worker')).status,'deducted');const once=balances();await menu.record(oatWaste,'worker');assert.equal(balances(),once);
const original=(await menu.sales(companyId,'recipe','latte'))[0];assert.ok(original);assert.equal((await menu.record({...waste,operationId:crypto.randomUUID(),mode:'sold',sale:{applicationKey:original.applicationKey,lineId:original.lineId}},'worker')).status,'classified');assert.equal(balances(),once,'Already-counted Waste uses the original sale without a new milk deduction.');
const competing=[1,2].map(n=>({...next,operationId:'race'+n,versionId:'race'+n,expectedActiveVersionId:'v2',expectedModifiers:{whole:'whole2',oat:'oat2',shot:'shot2'},modifiers:input.modifiers.map(m=>({...m,versionId:m.modifierId+'race'+n}))}));
const results=await Promise.allSettled(competing.map(b=>publishRecipe(db,b,'2026-04-05T00:00:00Z')));assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);assert.equal(sql.prepare("SELECT count(*) n FROM recipe_versions WHERE status='active'").get().n,1);assert.equal(sql.prepare("SELECT count(*) n FROM inventory_setup_operations WHERE operation_id LIKE 'race%'").get().n,1);
globalThis.recipeChoiceTestDb=db;
await build({entryPoints:['src/lib/import-sales.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/recipe-choices/legacy-import.js',plugins:[{name:'legacy-db',setup(b){b.onResolve({filter:/db\/raw$/},()=>({path:'test-db',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function database(){return globalThis.recipeChoiceTestDb}'}));}}]});
const {importSales}=await import('../.sites-runtime/recipe-choices/legacy-import.js');const darkBefore=balances();await assert.rejects(importSales(companyId,'gate-dark',[{recipeId:'latte',quantity:1}],actor),/needs customer choices/);assert.equal(balances(),darkBefore);
// Reviewing a migrated recipe preserves the lineage used by existing mappings.
sql.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES(?,?,?,?)').run(companyId,'older-latte',actor,now);
sql.prepare("INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,legacy,active_from,created_by,created_at) VALUES(?,?,?,1,'active',?,1,?,?,?)").run(companyId,'older-latte','legacy-latte','Older latte',now,actor,now);
const older=(await stock.read(companyId)).legacyRecipes.find(r=>r.recipeId==='older-latte');assert.equal(older.versionId,'legacy-latte');
await publishRecipe(db,{...input,recipeId:older.recipeId,name:older.name,operationId:'legacy-review',versionId:'reviewed-latte',expectedActiveVersionId:older.versionId,choices:[],modifiers:[]},'2026-05-01T00:00:00Z');
assert.equal(sql.prepare("SELECT recipe_id FROM recipe_versions WHERE id='reviewed-latte'").get().recipe_id,'older-latte');
assert.equal(sql.prepare("SELECT status FROM recipe_versions WHERE id='legacy-latte'").get().status,'archived');
console.log('Recipe choices: atomic publication, required milk, extras, history, retry, rollback, mixed sales, and company isolation passed.');
