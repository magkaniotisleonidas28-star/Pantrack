import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime', {recursive:true});
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries) sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
class Statement {
  constructor(query, values=[]) { Object.assign(this,{query,values}); }
  bind(...values) { return new Statement(this.query,values); }
  async first() { return sql.prepare(this.query).get(...this.values) ?? null; }
  async all() { return {results:sql.prepare(this.query).all(...this.values)}; }
  run() { return sql.prepare(this.query).run(...this.values); }
}
globalThis.testDB = {prepare:query=>new Statement(query), async batch(statements) {
  sql.exec('BEGIN IMMEDIATE');
  try { const result=statements.map(statement=>statement.run()); sql.exec('COMMIT'); return result; }
  catch(error) { sql.exec('ROLLBACK'); throw error; }
}};
globalThis.testEnv = {M3_EXACT_PREVIEW_ENABLED:'true'};
globalThis.testUser = {userId:'owner-a',email:'owner@example.test'};
const plugin = {name:'route-mocks',setup(bundle) {
  bundle.onResolve({filter:/chatgpt-auth|db\/raw|^cloudflare:workers$/},args=>({path:args.path,namespace:'mock'}));
  bundle.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path.includes('chatgpt-auth')
    ? 'export async function getChatGPTUser(){return globalThis.testUser}'
    : args.path.includes('cloudflare:') ? 'export const env=globalThis.testEnv'
      : 'export function database(){return globalThis.testDB}'}));
}};
await build({entryPoints:['src/app/api/inventory/exact/route.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.sites-runtime/exact-inventory-route.mjs',plugins:[plugin]});
const api = await import('../.sites-runtime/exact-inventory-route.mjs');
const at = new Date(Date.now()-60_000).toISOString();
for (const company of ['a','b']) {
  sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(company, company, at);
  sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(`owner-${company}`,company,'owner');
  sql.prepare('INSERT INTO products VALUES (?,?,?)').run(company,'milk',JSON.stringify({name:'Milk'}));
}
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('employee','a','employee');
const get = (company='a',kind='list',values={}) => api.GET(new Request(`https://test/api/inventory/exact?${new URLSearchParams({companyId:company,kind,...values})}`));
const post = (action,values={},company='a') => api.POST(new Request('https://test/api/inventory/exact',
  {method:'POST',headers:{'Content-Type':'application/json','Origin':'https://test'},
    body:JSON.stringify({companyId:company,action,...values})}));
const body = async response => {const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};

globalThis.testUser = null;
assert.equal((await get()).status,401);
assert.equal((await post('configure',{productId:'milk'})).status,401);
globalThis.testUser = {userId:'owner-b'};
assert.equal((await get()).status,403);
assert.equal((await post('configure',{productId:'milk'})).status,403);
globalThis.testUser = {userId:'employee'};
assert.equal((await get()).status,403);
assert.equal((await post('configure',{productId:'milk'})).status,403);
globalThis.testUser = {userId:'owner-a'};

const first = await body(await get());
assert.equal(first.products.length,1);
const configToken = (await body(await get('a','config',{productId:'milk'}))).token;
await body(await post('configure',{productId:'milk',expected:configToken,unit:{kind:'curated',unitId:'g'},
  purchaseUnitLabel:'bag',packAmount:'100'}));
const countToken = (await body(await get('a','count',{productId:'milk'}))).token;
const counted = await body(await post('count',{productId:'milk',expected:countToken,unitId:'g',
  unitVersion:1,amount:'12.5',effectiveAt:at}));
assert.equal(counted.opening,true);
const movementToken=(await body(await get('a','movement',{productId:'milk'}))).token;
const delivery={productId:'milk',expected:movementToken,movementId:'delivery-1',movement:'receive',
  unitId:'g',unitVersion:1,amount:'2',note:'Delivery'};
assert.equal((await body(await post('movement',delivery))).replayed,false);
assert.equal((await body(await post('movement',delivery))).replayed,true);
const recipeId='latte';
const recipeToken=(await body(await get('a','recipe',{recipeId}))).token;
const draft=await body(await post('recipeDraft',{recipeId,expected:recipeToken,name:'Latte',
  ingredients:[{productId:'milk',unitId:'g',unitVersion:1,amount:'2'}]}));
const activeToken=(await body(await get('a','recipe',{recipeId}))).token;
await body(await post('recipeActivate',{recipeId,versionId:draft.id,expected:activeToken}));
const modifierId='extra';
const modifierToken=(await body(await get('a','modifier',{recipeId,modifierId}))).token;
const extra=await body(await post('modifierDraft',{recipeId,modifierId,expected:modifierToken,
  name:'Extra milk',deltas:[{productId:'milk',unitId:'g',unitVersion:1,amount:'0.5'}]}));
const extraToken=(await body(await get('a','modifier',{recipeId,modifierId}))).token;
await body(await post('modifierActivate',{recipeId,modifierId,versionId:extra.id,expected:extraToken}));
const listing=await body(await get());
assert.ok(listing.recipes.some(row=>row.versionId===draft.id && row.status==='active'));
assert.ok(listing.modifiers.some(row=>row.versionId===extra.id && row.status==='active'));
assert.ok(listing.ingredients.some(row=>row.versionId===draft.id && row.amount==='2'));
assert.ok(listing.deltas.some(row=>row.versionId===extra.id && row.amount==='0.5'));
assert.ok(listing.counts.some(row=>row.opening===1));
assert.equal(listing.products[0].onHandMinor,'14500000');

assert.equal((await post('count',{productId:'milk',expected:countToken,unitId:'g',unitVersion:1,
  amount:'1',effectiveAt:at})).status,409);
globalThis.testUser={userId:'owner-b'};
assert.equal((await get('a','recipe',{recipeId})).status,403);
assert.equal((await post('recipeDraft',{recipeId,expected:recipeToken,name:'Bad',ingredients:[]})).status,403);
sql.prepare("INSERT INTO inventory(company_id,product_id,data,version) VALUES ('b','milk','{}',1)").run();
assert.deepEqual((await body(await get('b'))).legacy.products,
  [{productId:'milk',changedSinceBackfill:true,needsOpeningCount:true}]);
sql.prepare("UPDATE inventory SET data=?,version=2 WHERE company_id='b' AND product_id='milk'")
  .run(JSON.stringify({updated:at,settings:{unit:'cup',unitsPerPack:10}}));
sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,label,created_by,created_at)
  VALUES ('b','milk','legacy-stock',1,'legacy_unclassified','cup','migration',?)`).run(at);
sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,legacy_units_per_pack,effective_from,created_by,created_at)
  VALUES ('b','milk','legacy',1,'legacy_unclassified','legacy-stock',1,'bag','10',?,'migration',?)`).run(at,at);
assert.deepEqual((await body(await get('b'))).legacy.products,
  [{productId:'milk',changedSinceBackfill:false,needsOpeningCount:true}]);
sql.prepare("INSERT INTO recipe_lineages VALUES ('b','old-menu','migration',?)").run(at);
sql.prepare("INSERT INTO recipe_versions VALUES ('b','old-menu','legacy',1,'active','Old latte',?,NULL,1,'migration',?)").run(at,at);
sql.prepare("INSERT INTO recipes(company_id,id,data) VALUES ('b','old-menu',?)").run(JSON.stringify({name:'Old latte',ingredients:[]}));
assert.deepEqual((await body(await get('b'))).legacy.recipes,
  [{recipeId:'old-menu',changedSinceBackfill:false,needsReviewedVersion:true}]);
sql.prepare("UPDATE recipes SET data=? WHERE company_id='b' AND id='old-menu'")
  .run(JSON.stringify({name:'Changed latte',ingredients:[]}));
assert.equal((await body(await get('b'))).legacy.recipes[0].changedSinceBackfill,true);
const legacyToken=(await body(await get('b','config',{productId:'milk'}))).token;
assert.equal((await post('configure',{productId:'milk',expected:legacyToken,unit:{kind:'curated',unitId:'g'},
  purchaseUnitLabel:'bag'},'b')).status,409);
globalThis.testEnv.M3_EXACT_PREVIEW_ENABLED='false';
assert.equal((await get('b')).status,404);
assert.equal((await post('configure',{} ,'b')).status,404);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: gated exact inventory route, manager operations, anonymous/role/company denial, stale edits and disabled preview (SQLite D1 harness).');
sql.close();
