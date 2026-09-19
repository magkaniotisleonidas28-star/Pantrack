import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
assert.equal(journal.entries.length,10,'A3 compatibility harness expects migration 0009.');
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
const plain=rows=>rows.map(row=>({...row}));

for(const entry of journal.entries.slice(0,9))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));

const insertCompany=sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)');
const insertProduct=sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)');
const insertInventory=sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)');
const insertRecipe=sql.prepare('INSERT INTO recipes(company_id,id,data) VALUES (?,?,?)');
const insertEvent=sql.prepare('INSERT INTO inventory_events(company_id,id,product_id,data,created) VALUES (?,?,?,?,?)');
const insertSalesImport=sql.prepare('INSERT INTO sales_imports(company_id,reference,data,created) VALUES (?,?,?,?)');

for(const [id,name] of [['company-a','A'],['company-b','B'],['company-blank','Blank']])insertCompany.run(id,name,'2026-01-01T00:00:00.000Z');

function seed({companyId,productId='ingredient',productUnit,stockUnit,unitsPerPack,recipeName,recipeQuantity,updated='2026-01-04T00:00:00.000Z'}){
 insertProduct.run(companyId,productId,JSON.stringify({id:productId,name:`${companyId} ingredient`,unit:productUnit}));
 insertInventory.run(companyId,productId,JSON.stringify({
  productId,
  settings:{unit:stockUnit,unitsPerPack,targetStock:null,dailyUse:0,leadDays:2,safety:0,reviewDays:7,countEveryDays:30,location:'Stockroom',capacity:null,shelfDays:null,expiry:'',variancePct:5},
  onHand:50,incoming:0,lastCount:'2026-01-03T00:00:00.000Z',updated,version:3,estimatedUsed:0,
 }),3);
 insertRecipe.run(companyId,'recipe',JSON.stringify({id:'recipe',name:recipeName,ingredients:[{productId,quantity:recipeQuantity,unit:stockUnit}]}));
}

seed({companyId:'company-a',productUnit:'case',stockUnit:'fl oz',unitsPerPack:128,recipeName:'Latte',recipeQuantity:10});
seed({companyId:'company-b',productUnit:'bag',stockUnit:'g',unitsPerPack:1000,recipeName:'Coffee',recipeQuantity:2.5});
seed({companyId:'company-blank',productUnit:'',stockUnit:'',unitsPerPack:1,recipeName:'',recipeQuantity:1});

insertEvent.run('company-a','count-1','ingredient',JSON.stringify({id:'count-1',productId:'ingredient',action:'count',quantity:100,note:'Opening',actor:'owner-a',created:'2026-01-01T00:00:00.000Z'}),'2026-01-01T00:00:00.000Z');
insertEvent.run('company-a','use-1','ingredient',JSON.stringify({id:'use-1',productId:'ingredient',action:'use',quantity:5,note:'Use',actor:'owner-a',created:'2026-01-02T00:00:00.000Z'}),'2026-01-02T00:00:00.000Z');
insertEvent.run('company-a','count-2','ingredient',JSON.stringify({id:'count-2',productId:'ingredient',action:'count',quantity:80,note:'Recount',actor:'manager-a',created:'2026-01-03T00:00:00.000Z'}),'2026-01-03T00:00:00.000Z');
insertEvent.run('company-b','count-1','ingredient',JSON.stringify({id:'count-1',productId:'ingredient',action:'count',quantity:40,note:'Opening B',actor:'owner-b',created:'2026-01-01T00:00:00.000Z'}),'2026-01-01T00:00:00.000Z');
insertSalesImport.run('company-a','register-close-1',JSON.stringify({reference:'register-close-1',items:[{recipeId:'recipe',quantity:2}]}),'2026-01-03T12:00:00.000Z');
insertSalesImport.run('company-b','register-close-1',JSON.stringify({reference:'register-close-1',items:[{recipeId:'recipe',quantity:4}]}),'2026-01-03T13:00:00.000Z');

const oldRows={
 products:sql.prepare('SELECT * FROM products ORDER BY owner,id').all(),
 inventory:sql.prepare('SELECT * FROM inventory ORDER BY company_id,product_id').all(),
 recipes:sql.prepare('SELECT * FROM recipes ORDER BY company_id,id').all(),
 events:sql.prepare('SELECT * FROM inventory_events ORDER BY company_id,id').all(),
 salesImports:sql.prepare('SELECT * FROM sales_imports ORDER BY company_id,reference').all(),
};

sql.exec(readFileSync(`drizzle/${journal.entries[9].tag}.sql`,'utf8'));

assert.deepEqual(sql.prepare('SELECT * FROM products ORDER BY owner,id').all(),oldRows.products,'Product JSON changed during additive migration.');
assert.deepEqual(sql.prepare('SELECT * FROM inventory ORDER BY company_id,product_id').all(),oldRows.inventory,'Inventory JSON changed during additive migration.');
assert.deepEqual(sql.prepare('SELECT * FROM recipes ORDER BY company_id,id').all(),oldRows.recipes,'Recipe JSON changed during additive migration.');
assert.deepEqual(sql.prepare('SELECT * FROM inventory_events ORDER BY company_id,id').all(),oldRows.events,'Inventory history changed during additive migration.');
assert.deepEqual(sql.prepare('SELECT * FROM sales_imports ORDER BY company_id,reference').all(),oldRows.salesImports,'Sales import history changed during additive migration.');

const units=plain(sql.prepare('SELECT company_id,label,kind,dimension,numerator,denominator FROM product_unit_versions ORDER BY company_id').all());
assert.deepEqual(units,[
 {company_id:'company-a',label:'fl oz',kind:'legacy_unclassified',dimension:null,numerator:null,denominator:null},
 {company_id:'company-b',label:'g',kind:'legacy_unclassified',dimension:null,numerator:null,denominator:null},
 {company_id:'company-blank',label:'',kind:'legacy_unclassified',dimension:null,numerator:null,denominator:null},
]);

const configs=plain(sql.prepare('SELECT company_id,status,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack FROM inventory_config_versions ORDER BY company_id').all());
assert.deepEqual(configs,[
 {company_id:'company-a',status:'legacy_unclassified',purchase_unit_label:'case',purchase_quantity_minor:null,legacy_units_per_pack:'128'},
 {company_id:'company-b',status:'legacy_unclassified',purchase_unit_label:'bag',purchase_quantity_minor:null,legacy_units_per_pack:'1000'},
 {company_id:'company-blank',status:'legacy_unclassified',purchase_unit_label:'',purchase_quantity_minor:null,legacy_units_per_pack:'1'},
]);

const versions=plain(sql.prepare('SELECT company_id,recipe_id,id,version,status,name,legacy FROM recipe_versions ORDER BY company_id').all());
assert.deepEqual(versions,[
 {company_id:'company-a',recipe_id:'recipe',id:'legacy',version:1,status:'active',name:'Latte',legacy:1},
 {company_id:'company-b',recipe_id:'recipe',id:'legacy',version:1,status:'active',name:'Coffee',legacy:1},
 {company_id:'company-blank',recipe_id:'recipe',id:'legacy',version:1,status:'active',name:'',legacy:1},
]);

const ingredients=plain(sql.prepare('SELECT company_id,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label FROM recipe_version_ingredients ORDER BY company_id').all());
assert.deepEqual(ingredients,[
 {company_id:'company-a',product_id:'ingredient',unit_id:'legacy-stock',unit_version:1,dimension:null,quantity_minor:null,entered_amount:'10',entered_unit_id:null,legacy_unit_label:'fl oz'},
 {company_id:'company-b',product_id:'ingredient',unit_id:'legacy-stock',unit_version:1,dimension:null,quantity_minor:null,entered_amount:'2.5',entered_unit_id:null,legacy_unit_label:'g'},
 {company_id:'company-blank',product_id:'ingredient',unit_id:'legacy-stock',unit_version:1,dimension:null,quantity_minor:null,entered_amount:'1',entered_unit_id:null,legacy_unit_label:''},
]);

const reconciliations=plain(sql.prepare('SELECT company_id,id,entered_amount,legacy_unit_label,dimension,measured_minor,estimate_before_minor,variance_minor,actor,note,opening FROM inventory_reconciliations ORDER BY company_id,effective_at,id').all());
assert.deepEqual(reconciliations,[
 {company_id:'company-a',id:'legacy:count-1',entered_amount:'100',legacy_unit_label:'fl oz',dimension:null,measured_minor:null,estimate_before_minor:null,variance_minor:null,actor:'owner-a',note:'Opening',opening:1},
 {company_id:'company-a',id:'legacy:count-2',entered_amount:'80',legacy_unit_label:'fl oz',dimension:null,measured_minor:null,estimate_before_minor:null,variance_minor:null,actor:'manager-a',note:'Recount',opening:0},
 {company_id:'company-b',id:'legacy:count-1',entered_amount:'40',legacy_unit_label:'g',dimension:null,measured_minor:null,estimate_before_minor:null,variance_minor:null,actor:'owner-b',note:'Opening B',opening:1},
]);

for(const table of ['inventory_balances_exact','inventory_consumption_applications','inventory_events_exact','recipe_modifier_lineages','recipe_modifier_versions','recipe_modifier_deltas']){
 assert.equal(sql.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,0,`${table} should not invent exact or modifier data.`);
}

const insertApplication=sql.prepare(`INSERT INTO inventory_consumption_applications(
 company_id,idempotency_key,contract,request_fingerprint,occurred_at,result_json,applied_at
) VALUES (?,?,?,?,?,?,?)`);
insertApplication.run('company-a','sale-1','pantrack.inventory-consumption.v1','fingerprint-a','2026-01-05T00:00:00.000Z','{}','2026-01-05T00:00:01.000Z');
insertApplication.run('company-b','sale-1','pantrack.inventory-consumption.v1','fingerprint-b','2026-01-05T00:00:00.000Z','{}','2026-01-05T00:00:01.000Z');
assert.throws(
 ()=>insertApplication.run('company-a','sale-1','pantrack.inventory-consumption.v1','changed','2026-01-05T00:00:00.000Z','{}','2026-01-05T00:00:01.000Z'),
 /UNIQUE constraint failed/,
 'An applied idempotency key must be claimed once per company.',
);

const insertExactEvent=sql.prepare(`INSERT INTO inventory_events_exact(
 company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,
 entered_unit_id,balance_version_before,balance_version_after,effective_at,recorded_at,
 actor,note,consumption_key
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
insertExactEvent.run('company-a','consume-1','ingredient','legacy','consume','volume','-10',null,null,0,1,'2026-01-05T00:00:00.000Z','2026-01-05T00:00:01.000Z','sales-ingestion','', 'sale-1');
insertExactEvent.run('company-a','consume-2','ingredient','legacy','consume','volume','-5',null,null,1,2,'2026-01-05T00:00:00.000Z','2026-01-05T00:00:01.000Z','sales-ingestion','', 'sale-1');
assert.equal(sql.prepare("SELECT count(*) AS count FROM inventory_events_exact WHERE company_id='company-a' AND consumption_key='sale-1'").get().count,2,'One atomic application must be able to own multiple inventory events.');

assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
console.log('PASS: A3 additive migration preserves legacy JSON/history, isolates companies, backfills unclassified unit and recipe versions, and records count reconciliation without inventing canonical values.');
