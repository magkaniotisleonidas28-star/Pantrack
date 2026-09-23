import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
await build({entryPoints:['src/lib/legacy-m3-review.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/legacy-m3-review.mjs'});
const {legacyM3Review}=await import('../.sites-runtime/legacy-m3-review.mjs');

const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
assert.match(journal.entries[9].tag,/^0009_/);
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
for(const entry of journal.entries.slice(0,9))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));

const stock=(productId,updated)=>JSON.stringify({productId,settings:{unit:'mL',unitsPerPack:1000},onHand:10,updated});
const recipe=(name,quantity)=>JSON.stringify({id:'latte',name,ingredients:[{productId:'milk',quantity,unit:'mL'}]});
for(const companyId of ['company-a','company-b']){
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(companyId,companyId,'2026-01-01T00:00:00.000Z');
  sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(companyId,'milk',JSON.stringify({id:'milk',name:'Test milk',unit:'carton'}));
  sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run(companyId,'milk',stock('milk','2026-01-02T00:00:00.000Z'),1);
  sql.prepare('INSERT INTO recipes(company_id,id,data) VALUES (?,?,?)').run(companyId,'latte',recipe('Latte',10));
}
sql.exec(readFileSync(`drizzle/${journal.entries[9].tag}.sql`,'utf8'));

const db={prepare(query){return {bind(...values){return {async all(){return {results:sql.prepare(query).all(...values)};}};}};}};
const changes=()=>sql.prepare('SELECT total_changes() AS count').get().count;
const before=changes();
const baseline=await legacyM3Review(db,'company-a');
assert.deepEqual(baseline,{
  products:[{productId:'milk',changedSinceBackfill:false,needsOpeningCount:true}],
  recipes:[{recipeId:'latte',changedSinceBackfill:false,needsReviewedVersion:true}],
});
assert.equal(changes(),before,'Review must not write to the database.');

sql.prepare('UPDATE inventory SET data=?,version=2 WHERE company_id=? AND product_id=?').run(stock('milk','2026-01-03T00:00:00.000Z'),'company-a','milk');
sql.prepare('UPDATE recipes SET data=? WHERE company_id=? AND id=?').run(recipe('Latte',11),'company-a','latte');
const changed=await legacyM3Review(db,'company-a');
assert.equal(changed.products[0].changedSinceBackfill,true);
assert.equal(changed.recipes[0].changedSinceBackfill,true);
assert.deepEqual(await legacyM3Review(db,'company-b'),baseline,'Other company data must remain isolated.');

sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run('company-a','cups',JSON.stringify({id:'cups',name:'Test cups',unit:'case'}));
sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run('company-a','cups',stock('cups','2026-01-04T00:00:00.000Z'),1);
const afterBackfill=await legacyM3Review(db,'company-a');
assert.deepEqual(afterBackfill.products.find(item=>item.productId==='cups'),{productId:'cups',changedSinceBackfill:true,needsOpeningCount:true});
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log('PASS: read-only legacy review flags post-backfill stock and recipe changes, missing exact review, and isolates companies.');
