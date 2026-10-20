import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const entry of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));
class Statement{constructor(query,values=[]){this.query=query;this.values=values;}bind(...values){return new Statement(this.query,values);}async first(){return sql.prepare(this.query).get(...this.values)??null;}async all(){return {results:sql.prepare(this.query).all(...this.values)};}async run(){if(/^\s*SELECT\b/i.test(this.query))return {results:sql.prepare(this.query).all(...this.values),meta:{changes:0}};const r=sql.prepare(this.query).run(...this.values);return {results:[],meta:{changes:Number(r.changes)}};}}
globalThis.testDB={prepare(query){return new Statement(query);},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const item of statements)results.push(await item.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
globalThis.testEnv={CLOVER_ENVIRONMENT:'sandbox',CLOVER_CLIENT_ID:'app',CLOVER_CLIENT_SECRET:'secret',CLOVER_WEBHOOK_AUTH_CODE:'hook',VENDOR_ENCRYPTION_KEY:btoa('a'.repeat(32)),PANTRACK_CLOVER_SYNC_ENABLED:'enabled'};
const plugin={name:'mocks',setup(build){build.onResolve({filter:/^cloudflare:workers$|^@\/db\/raw$/},args=>({path:args.path,namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.testEnv':'export function database(){return globalThis.testDB}'}));}};
for(const [name,path] of [['sync','src/lib/clover-sync.ts'],['orders','src/lib/clover-orders.ts'],['crypto','src/lib/vendor-adapter.ts'],['webhook','src/app/api/clover/webhook/route.ts']])await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',outfile:`.sites-runtime/clover-pagination-${name}.mjs`,plugins:[plugin]});
const {syncClover,cloverSyncStatus}=await import('../.sites-runtime/clover-pagination-sync.mjs');
const {normalizeCloverOrder,normalizeCloverDeletedOrder}=await import('../.sites-runtime/clover-pagination-orders.mjs');
const {encrypt}=await import('../.sites-runtime/clover-pagination-crypto.mjs');
const webhook=await import('../.sites-runtime/clover-pagination-webhook.mjs');
const now=Date.now(),cutoff=new Date(now-50*3600_000).toISOString(),started=now-49*3600_000;
for(const id of ['a','b'])sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(id,id,cutoff);
function stock(id,dimension,onHand){sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a',id,'{}');sql.prepare('INSERT INTO product_unit_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)').run('a',id,'canonical',1,'curated',dimension,'canonical','1','1','fixture',cutoff);sql.prepare('INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)').run('a',id,'active',1,'active','canonical',1,'unit','1',cutoff,'fixture',cutoff);sql.prepare("INSERT INTO inventory_balances_exact VALUES (?,?,?,?,?,'0','0',?,?,?)").run('a',id,'active',dimension,onHand,1,cutoff,cutoff);}
stock('cup','count','10');
sql.prepare('INSERT INTO recipe_lineages VALUES (?,?,?,?)').run('a','drink','fixture',cutoff);
sql.prepare("INSERT INTO recipe_versions VALUES (?,?,?,1,'draft',?,NULL,NULL,0,?,?)").run('a','drink','drink-v1','Drink','fixture',cutoff);
sql.prepare("INSERT INTO recipe_version_ingredients VALUES (?,?,?,?,?,'canonical',1,?,?,?,'canonical',NULL)").run('a','drink','drink-v1',0,'cup','count','1','1');
sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='a' AND recipe_id='drink'").run(cutoff);
sql.prepare('INSERT INTO clover_item_mappings VALUES (?,?,?,?,?)').run('a','sandbox','merchant','item','drink');
const token={access_token:'access',refresh_token:'refresh',access_token_expiration:Math.floor(now/1000)+3600,refresh_token_expiration:Math.floor(now/1000)+86400};
sql.prepare('INSERT INTO clover_connections VALUES (?,?,?,?,?,?,0)').run('a','merchant','sandbox',await encrypt(JSON.stringify(token),'clover:a'),cutoff,null);
sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until) VALUES (?,?,?,?,?,0)').run('a','sandbox','merchant',started,started);

sql.prepare("UPDATE inventory_balances_exact SET on_hand_minor='10000' WHERE company_id='a'").run();
const upper=started+24*3600_000;
let fixtures=[],listCalls=0,moveFirst=false,breakOrdering=false;
const initial=sql.prepare('SELECT * FROM clover_sync_state').get();
function reset(count,{ties=false,move=false}={}){
 sql.prepare('UPDATE clover_sync_state SET checkpoint=?,lease_until=0 WHERE company_id=?').run(started,'a');
 listCalls=0;moveFirst=move;breakOrdering=false;
 fixtures=Array.from({length:count},(_,i)=>({id:String(i).padStart(13,'0'),createdTime:started+1000,
  modifiedTime:started+2*3600_000+(ties?0:i),total:500,paymentState:'PAID',
  payments:{elements:[{id:'payment',createdTime:started+2000}]},
  lineItems:{elements:[{id:'line',item:{id:'item'},modifications:{elements:[]}}]}}));
}
globalThis.fetch=async url=>{
 const u=new URL(String(url));assert.equal(u.origin,'https://apisandbox.dev.clover.com','Fake transport only');
 if(u.pathname.endsWith('/orders')){
  const filters=u.searchParams.getAll('filter');
  if(filters.some(f=>f.startsWith('deletedTime')))return Response.json({elements:[]});
  if(++listCalls===2&&moveFirst)fixtures[0].modifiedTime=upper+1;
  const rows=fixtures.filter(row=>filters.every(f=>{
   const match=/^(modifiedTime|id)(>=|<=|>|<|=)(.+)$/.exec(f);assert.ok(match,'Supported filter: '+f);
   const [,field,op,raw]=match,value=field==='id'?raw:Number(raw),actual=row[field];
   return op==='>='?actual>=value:op==='<='?actual<=value:op==='>'?actual>value:op==='<'?actual<value:actual===value;
  })).sort((a,b)=>a.modifiedTime-b.modifiedTime||(a.id<b.id?-1:a.id>b.id?1:0));
  const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit'));
  const page=rows.slice(offset,offset+limit);
  return Response.json({elements:breakOrdering&&page.length>1?page.toReversed():page});
 }
 const id=u.pathname.split('/').at(-1),order=fixtures.find(f=>f.id===id);assert.ok(order);
 return Response.json(order);
};
reset(101,{move:true});
const result=await syncClover('a');
const missed=fixtures.at(-1).id;
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sales_events WHERE external_order_id=?').get(missed).n,1,'F3: shifting page cannot skip the last in-window order while advancing checkpoint');
assert.equal(result.created,101);assert.equal(new Date(result.checkpoint).getTime(),upper);
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='a' AND product_id='cup'").get().on_hand_minor,'9899','All 101 orders deduct exactly once');
reset(125,{ties:true});
fixtures.forEach(f=>f.id='T'+f.id);
fixtures.push({...fixtures[0],id:'A000000000000',modifiedTime:started+3*3600_000});
const tied=await syncClover('a');assert.equal(tied.created,126,'Timestamp ties and a later timestamp with a smaller ID are all ingested');
sql.prepare('UPDATE clover_sync_state SET checkpoint=?').run(started);
const replay=await syncClover('a');assert.equal(replay.created,0);assert.equal(replay.duplicates,126,'Repeated scan remains idempotent');
reset(2000,{ties:true});fixtures.forEach(f=>f.id='MAX'+f.id);
await assert.rejects(()=>syncClover('a'),/page limit reached; checkpoint was not advanced/);
assert.equal(sql.prepare('SELECT checkpoint FROM clover_sync_state').get().checkpoint,initial.checkpoint);
assert.equal(listCalls,20,'MAX_PAGES still bounds requests');
reset(101);breakOrdering=true;
await assert.rejects(()=>syncClover('a'),/orders page/);
assert.equal(sql.prepare('SELECT checkpoint FROM clover_sync_state').get().checkpoint,initial.checkpoint,'Invalid provider ordering cannot advance checkpoint');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);sql.close();
console.log('PASS: F3 moving pages, timestamp ties, ID ordering, replay, page bounds and invalid-order refusal; fake Clover only');
