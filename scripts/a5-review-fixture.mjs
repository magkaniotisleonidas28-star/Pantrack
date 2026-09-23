import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const mode=process.argv[2];
if(mode!=='seed'&&mode!=='verify')throw new Error('Expected seed or verify.');
const databaseDir=fileURLToPath(new URL('../.sites-runtime/a5-review-state/v3/d1/miniflare-D1DatabaseObject/',import.meta.url));
const files=readdirSync(databaseDir).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite');
assert.equal(files.length,1,'Expected exactly one isolated A5 D1 database.');
const sql=new DatabaseSync(join(databaseDir,files[0]));
sql.exec('PRAGMA foreign_keys=ON');

const companyId='a5-fictional-cafe',productId='a5-fictional-milk',recipeId='a5-fictional-latte';
const baselineAt='2026-01-02T00:00:00.000Z',changedAt='2026-01-03T00:00:00.000Z';
const settings={unit:'mL',unitsPerPack:1000,targetStock:null,dailyUse:0,leadDays:2,safety:0,reviewDays:7,countEveryDays:30,location:'Fictional stockroom',capacity:null,shelfDays:null,expiry:'',variancePct:5};
const currentStock={productId,settings,onHand:10,incoming:0,lastCount:null,updated:changedAt,version:2,estimatedUsed:0};
const currentRecipe={id:recipeId,name:'Fictional latte',ingredients:[{productId,quantity:12,unit:'mL'}]};

if(mode==='seed'){
  assert.equal(sql.prepare('SELECT count(*) AS count FROM companies').get().count,0,'The A5 fixture database must be empty before seeding.');
  sql.exec('BEGIN');
  try{
    sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(companyId,'Fictional A5 Review Cafe',baselineAt);
    sql.prepare('INSERT INTO memberships(user_id,company_id,role) VALUES (?,?,?)').run('local_seedy',companyId,'owner');
    sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(companyId,productId,JSON.stringify({id:productId,name:'Fictional milk',supplier:'Fictional supplier',sku:'A5-MILK',pack:'carton',unit:'carton',price:0,category:'Test only',url:'',sample:true}));
    sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run(companyId,productId,JSON.stringify(currentStock),2);
    sql.prepare('INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId,productId,'legacy-stock',1,'legacy_unclassified',null,'mL',null,null,'migration:0009',baselineAt,null);
    sql.prepare('INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId,productId,'legacy',1,'legacy_unclassified','legacy-stock',1,'carton',null,'1000','1970-01-01T00:00:00.000Z',null,'migration:0009',baselineAt);
    sql.prepare('INSERT INTO recipes(company_id,id,data) VALUES (?,?,?)').run(companyId,recipeId,JSON.stringify(currentRecipe));
    sql.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)').run(companyId,recipeId,'migration:0009',baselineAt);
    sql.prepare('INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(companyId,recipeId,'legacy',1,'draft','Fictional latte',null,null,1,'migration:0009',baselineAt);
    sql.prepare('INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(companyId,recipeId,'legacy',0,productId,null,null,null,null,'10',null,'mL');
    sql.prepare('UPDATE recipe_versions SET status=?,active_from=? WHERE company_id=? AND recipe_id=? AND id=?').run('active','1970-01-01T00:00:00.000Z',companyId,recipeId,'legacy');
    sql.exec('COMMIT');
  }catch(error){sql.exec('ROLLBACK');throw error;}
}

assert.equal(sql.prepare('SELECT data FROM inventory WHERE company_id=? AND product_id=?').get(companyId,productId)?.data,JSON.stringify(currentStock),'Fictional legacy stock must remain unchanged.');
assert.equal(sql.prepare('SELECT data FROM recipes WHERE company_id=? AND id=?').get(companyId,recipeId)?.data,JSON.stringify(currentRecipe),'Fictional legacy recipe must remain unchanged.');
assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_balances_exact WHERE company_id=?').get(companyId).count,0,'The report must not create an exact balance.');
assert.equal(sql.prepare('SELECT count(*) AS count FROM inventory_events_exact WHERE company_id=?').get(companyId).count,0,'The report must not create an exact inventory event.');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log(mode==='seed'?'PASS: separate fictional A5 review database seeded.':'PASS: fictional A5 stock and recipe are unchanged after review.');
