import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('.sites-runtime',{recursive:true});
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
globalThis.testDB={prepare(query){let v=[];return {bind(...values){v=values;return this},async run(){return sql.prepare(query).run(...v)},async first(){return sql.prepare(query).get(...v)||null},async all(){return {results:sql.prepare(query).all(...v)}}}},async batch(s){sql.exec('BEGIN');try{for(const i of s)await i.run();sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.testUser={userId:'owner-a',email:'a@example.test'};
sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('company-a','A','now');
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run('owner-a','company-a','owner');
for(const id of ['milk','cup'])sql.prepare('INSERT INTO products VALUES (?,?,?)').run('company-a',id,JSON.stringify({id,name:id}));
const plugin={name:'mocks',setup(b){b.onResolve({filter:/chatgpt-auth|db\/raw|^cloudflare:workers$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('chatgpt-auth')?'export async function getChatGPTUser(){return globalThis.testUser}':a.path.includes('cloudflare:')?'export const env={}':'export function database(){return globalThis.testDB}'}));}};
for(const name of ['inventory','sales'])await build({entryPoints:['src/app/api/'+name+'/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/test-'+name+'.mjs',plugins:[plugin]});
await build({entryPoints:['src/lib/inventory.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/inventory-math.mjs'});
const inv=await import('../.sites-runtime/test-inventory.mjs'),sales=await import('../.sites-runtime/test-sales.mjs'),{recommendation,defaultSettings}=await import('../.sites-runtime/inventory-math.mjs');
const send=(api,b)=>api.POST(new Request('https://test/api',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://test'},body:JSON.stringify({companyId:'company-a',...b})}));
const read=()=>inv.GET(new Request('https://test/api?companyId=company-a'));
async function mutation(productId,action,version,extra={}){const r=await send(inv,{id:crypto.randomUUID(),productId,action,version,...extra});assert.equal(r.status,200,JSON.stringify(await r.json()));}
for(const productId of ['milk','cup']){
 await mutation(productId,'settings',0,{settings:{...defaultSettings,unit:productId==='milk'?'fl oz':'cup',unitsPerPack:12,dailyUse:6,safety:6}});
 await mutation(productId,'count',1,{quantity:100});
}
const recipe={id:crypto.randomUUID(),name:'Latte',ingredients:[{productId:'milk',quantity:10,unit:'fl oz'},{productId:'cup',quantity:1,unit:'cup'}]};
assert.equal((await send(sales,{action:'recipe',recipe})).status,200);
const sale={action:'import',reference:'day-1',lines:[{recipeId:recipe.id,quantity:5}]};
assert.equal((await send(sales,sale)).status,200);
let rows=(await(await read()).json()).records;
assert.equal(rows.find(r=>r.productId==='milk').onHand,50);assert.equal(rows.find(r=>r.productId==='cup').onHand,95);
assert.equal(rows.find(r=>r.productId==='milk').estimatedUsed,50);
assert.equal((await send(sales,sale)).status,200);assert.equal((await(await read()).json()).records.find(r=>r.productId==='milk').onHand,50);
assert.equal((await send(inv,{id:crypto.randomUUID(),productId:'milk',action:'use',version:2,quantity:1})).status,409);
await mutation('milk','incoming',3,{quantity:24});await mutation('milk','receive',4,{quantity:12,fromIncoming:true});
rows=(await(await read()).json()).records;assert.equal(rows.find(r=>r.productId==='milk').onHand,62);assert.equal(rows.find(r=>r.productId==='milk').incoming,12);
await mutation('milk','count',5,{quantity:60});assert.equal((await(await read()).json()).records.find(r=>r.productId==='milk').estimatedUsed,0);
assert.equal((await send(inv,{id:crypto.randomUUID(),productId:'milk',action:'waste',version:6,quantity:1000})).status,400);
const now=Date.now(),record={productId:'milk',onHand:18,incoming:0,lastCount:new Date(now).toISOString(),updated:'',version:1,estimatedUsed:0,settings:{...defaultSettings,unitsPerPack:12,dailyUse:6,leadDays:2,safety:6,reviewDays:7}};
assert.equal(recommendation(record,now).packs,4);
assert.equal(recommendation({...record,incoming:48},now).packs,0);
assert.equal(recommendation({...record,lastCount:null},now).packs,0);
assert.equal(recommendation({...record,settings:{...record.settings,capacity:30}},now).packs,1);
assert.equal(recommendation({...record,estimatedUsed:1000},now).needsCheck,true);
globalThis.testUser={userId:'other'};assert.equal((await read()).status,403);assert.equal((await send(sales,sale)).status,403);
globalThis.testUser=null;assert.equal((await read()).status,401);assert.equal((await send(sales,sale)).status,401);
console.log('PASS: opening counts, recipe depletion, duplicate import protection, concurrent update rejection, receiving/incoming accounting, correction resets, negative manual stock prevention, reorder math/capacity/checks and company isolation.');

const targetRecord={...record,onHand:700,incoming:0,estimatedUsed:300,settings:{...defaultSettings,targetStock:1000,unitsPerPack:128}};
assert.equal(recommendation(targetRecord,now).packs,3);
assert.equal(recommendation(targetRecord,now).shortfall,300);
assert.equal(recommendation({...targetRecord,incoming:256},now).packs,1);
assert.equal(recommendation({...targetRecord,incoming:384},now).packs,0);
assert.equal(recommendation({...targetRecord,settings:{...targetRecord.settings,targetStock:0}},now).packs,0);
assert.equal(recommendation({...targetRecord,settings:{...targetRecord.settings,capacity:1000}},now).packs,2);
assert.equal(recommendation({...targetRecord,lastCount:null},now).packs,0);
console.log('PASS: explicit target with zero forecast usage, exact shortfall, whole-case rounding, incoming stock, zero target, storage limits and opening count requirement.');

globalThis.testUser={userId:'owner-a',email:'a@example.test'};
const mapping={provider:'Test POS',location:'store-1',itemId:'latte-small',name:'Small latte',recipeId:recipe.id};
assert.equal((await send(sales,{action:'mapping',mapping})).status,200);
const key=JSON.stringify([mapping.provider,mapping.location,mapping.itemId]);
let salesState=await (await sales.GET(new Request('https://test/api?companyId=company-a'))).json();
assert.equal(salesState.mappings.length,1);
assert.equal((await send(sales,{action:'mapping',mapping:{...mapping,name:'Updated latte'}})).status,200);
assert.equal((await send(sales,{action:'mapping',mapping:{...mapping,recipeId:crypto.randomUUID()}})).status,400);
const before=(await (await read()).json()).records.find(r=>r.productId==='milk').onHand;
assert.equal((await send(sales,{action:'import',reference:'mapped-unknown',lines:[{mappingKey:'unknown',quantity:1}]})).status,400);
assert.equal((await (await read()).json()).records.find(r=>r.productId==='milk').onHand,before);
const mappedSale={action:'import',reference:'mapped-day-1',lines:[{mappingKey:key,quantity:2}]};
assert.equal((await send(sales,mappedSale)).status,200);
assert.equal((await (await read()).json()).records.find(r=>r.productId==='milk').onHand,before-20);
assert.equal((await send(sales,mappedSale)).status,200);
assert.equal((await (await read()).json()).records.find(r=>r.productId==='milk').onHand,before-20);
globalThis.testUser={userId:'other'};
assert.equal((await send(sales,{action:'removeMapping',mappingKey:key})).status,403);
globalThis.testUser={userId:'owner-a',email:'a@example.test'};
assert.equal((await send(sales,{action:'removeMapping',mappingKey:key})).status,200);
assert.equal((await send(sales,{...mappedSale,reference:'mapped-day-2'})).status,400);
console.log('PASS: saved mapping CRUD, recipe ownership validation, exact mapping resolution, unmapped-sale blocking, recipe deductions, replay protection, and company isolation.');
sql.prepare('INSERT INTO products VALUES (?,?,?)').run('company-a','exact-only','{}');
sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at)
  VALUES ('company-a','exact-only','g',1,'curated','mass','g','1','1','owner','2026-01-01T00:00:00.000Z')`).run();
sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,effective_from,created_by,created_at)
  VALUES ('company-a','exact-only','exact-config',1,'active','g',1,'bag','2026-01-01T00:00:00.000Z','owner','2026-01-01T00:00:00.000Z')`).run();
assert.ok((await (await read()).json()).exactProductIds.includes('exact-only'));
assert.equal((await send(inv,{id:crypto.randomUUID(),productId:'exact-only',action:'settings',version:0,
  settings:{...defaultSettings,unit:'g',unitsPerPack:10,dailyUse:1,safety:1}})).status,409);
assert.equal(sql.prepare("SELECT count(*) AS n FROM inventory_events WHERE company_id='company-a' AND product_id='exact-only'").get().n,0);
console.log('PASS: the legacy inventory route cannot write a product with active exact configuration.');
