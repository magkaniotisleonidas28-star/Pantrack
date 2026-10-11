import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';

mkdirSync('.sites-runtime',{recursive:true});
writeFileSync('.sites-runtime/bug06-entry.ts',`export * from '../src/lib/d1-inventory-management';export * from '../src/lib/d1-stock-pack';export {GET,POST} from '../src/app/api/inventory/route';`);
await build({entryPoints:['.sites-runtime/bug06-entry.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/bug06-counts.mjs',plugins:[{name:'local-auth',setup(b){
 b.onResolve({filter:/^@\/(db\/raw|lib\/(chatgpt-auth|company-access|authorization|exact-inventory-gate))$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('db/raw')?'export const database=()=>globalThis.bug06Db':path.endsWith('chatgpt-auth')?'export const getChatGPTUser=async()=>globalThis.bug06User':path.endsWith('company-access')?'export const companyAccess=async(_user,company)=>company==="a"?{role:globalThis.bug06Role}:null':path.endsWith('authorization')?'export const withCompanyRoute=(_name,handler)=>handler':'export const exactInventoryPreviewEnabled=()=>true'}));
}}]});
const {D1InventoryManagementService,recordPackageStock,POST}=await import('../.sites-runtime/bug06-counts.mjs');
const deferred=()=>{let resolve;const promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};};
const gate=()=>({entered:deferred(),release:deferred()});
class Statement{
 constructor(db,query,values=[]){Object.assign(this,{db,query,values});}
 bind(...values){return new Statement(this.db,this.query,values);}
 async first(){return this.db.sql.prepare(this.query).get(...this.values)??null;}
 async all(){return {results:this.db.sql.prepare(this.query).all(...this.values)};}
 runSync(){const result=this.db.sql.prepare(this.query).run(...this.values);return {success:true,results:[],meta:{changes:Number(result.changes)}};}
 async run(){return this.runSync();}
}
class Database{
 constructor(sql){this.sql=sql;this.gates=[];this.metadata='accurate';}
 prepare(query){return new Statement(this,query);}
 async batch(statements){
  if(this.gates.length&&statements.some(s=>s.query.includes('INSERT OR IGNORE INTO inventory_reconciliations'))){const pending=this.gates.shift();pending.entered.resolve();await pending.release.promise;}
  this.sql.exec('BEGIN IMMEDIATE');let results;try{results=statements.map(s=>s.runSync());this.sql.exec('COMMIT');}catch(error){this.sql.exec('ROLLBACK');throw error;}
  if(this.loseResponse){this.loseResponse=false;throw new Error('Injected lost save response.');}
  return this.metadata==='accurate'?results:results.map(r=>({...r,meta:{changes:this.metadata==='zero'?0:1}}));
 }
}
const now='2026-03-01T00:00:00.000Z';
async function fixture(stockUnit={kind:'curated',id:'mL'}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const {tag} of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
 for(const company of ['a','b']){
  sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(company,company,now);
  for(const product of ['milk','other'])sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(company,product,JSON.stringify({id:product}));
 }
 const db=new Database(sql),service=new D1InventoryManagementService(db,{clock:{now:()=>new Date(now)}});
 const configure=overrides=>service.configure({companyId:'a',productId:'milk',operationId:'config-1',actor:'manager@example.test',stockUnit,purchaseUnitLabel:'pack',purchaseAmount:'1000',openingAmount:'1000',effectiveAt:'2026-01-01T00:00:00Z',...overrides});
 await configure({});await configure({productId:'other',operationId:'other-config'});
 if(stockUnit.id==='mL')for(const product of ['milk','other'])sql.prepare('INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)').run('a',product,'L',1,'curated','volume','L','1000','1','fixture',now);
 const count={companyId:'a',productId:'milk',operationId:'race-count',expectedVersion:1,actor:'manager@example.test',amount:'900',unitId:stockUnit.id,effectiveAt:'2026-01-02T00:00:00Z',note:'Shelf count'};
 globalThis.bug06Db=db;globalThis.bug06User={userId:'manager',email:count.actor};globalThis.bug06Role='manager';
 const snapshot=()=>['inventory_balances_exact','inventory','inventory_reconciliations','inventory_events_exact'].map(name=>sql.prepare(`SELECT * FROM ${name} ORDER BY 1,2`).all());
 return {sql,db,service,configure,count,snapshot};
}
async function race(h,second,save=input=>h.service.recordCount(input)){
 const one=gate(),two=gate();h.db.gates=[one,two];
 const first=save(h.count).then(value=>({value}),error=>({error}));await one.entered.promise;
 const other=save(second).then(value=>({value}),error=>({error}));await two.entered.promise;
 try{one.release.resolve();const winner=await first;assert.ok(!winner.error);const saved=h.snapshot();two.release.resolve();const loser=await other;assert.deepEqual(h.snapshot(),saved,'The second request must not change the saved count, projection, cutoff or event history.');return {winner,loser};}
 finally{one.release.resolve();two.release.resolve();await Promise.all([first,other]);}
}
for(const metadata of ['accurate','zero','positive']){
 for(const change of [{amount:'800'},{unitId:'L'},{effectiveAt:'2026-01-02T01:00:00Z'},{actor:'another-manager@example.test'},{note:'Different count'},{productId:'other'},{expectedVersion:0}]){
  const h=await fixture();h.db.metadata=metadata;
  const {loser}=await race(h,{...h.count,...change});
  assert.equal(loser.error?.code,'operation_conflict',`Conflicting ${Object.keys(change)[0]} with ${metadata} metadata must not report success.`);
  const balance=h.sql.prepare("SELECT on_hand_minor,version,latest_count_effective_at FROM inventory_balances_exact WHERE company_id='a' AND product_id='milk'").get();
  assert.deepEqual({...balance},{on_hand_minor:'900000000',version:2,latest_count_effective_at:'2026-01-02T00:00:00.000Z'});
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM inventory_reconciliations WHERE id='count:race-count'").get().n,1);assert.equal(h.sql.prepare("SELECT count(*) AS n FROM inventory_events_exact WHERE id='count:race-count'").get().n,1);h.sql.close();
 }
 const same=await fixture();same.db.metadata=metadata;
 const identical=await race(same,{...same.count,effectiveAt:'2026-01-01T19:00:00-05:00',note:'  Shelf count  '});
 assert.ok(!identical.loser.error,'Equivalent normalized time and trimmed note confirm the original count.');assert.equal(identical.loser.value.version,2);same.sql.close();
 const different=await fixture();different.db.metadata=metadata;
 const distinct=await race(different,{...different.count,operationId:'different-reference'});assert.equal(distinct.loser.error?.code,'concurrent_update','Different count IDs sharing a version cannot overwrite the winner.');different.sql.close();
}
const rejectsCode=(promise,code)=>assert.rejects(promise,e=>e.code===code);
{
 const h=await fixture();h.db.loseResponse=true;
 await assert.rejects(()=>h.service.recordCount(h.count),/lost save response/);const counted=h.snapshot();
 assert.equal((await h.service.recordCount(h.count)).version,2);assert.deepEqual(h.snapshot(),counted,'Lost-response confirmation makes no additional write.');
 await h.service.recordMovement({companyId:'a',productId:'milk',operationId:'later-receive',expectedVersion:2,actor:h.count.actor,action:'receive',amount:'100',unitId:'mL',effectiveAt:'2026-01-03T00:00:00Z',note:'Delivery'});
 await h.configure({operationId:'config-L',stockUnit:{kind:'curated',id:'L'},purchaseAmount:'1',openingAmount:undefined,effectiveAt:'2026-01-04T00:00:00Z'});
 const latest=h.snapshot();assert.equal((await h.service.recordCount(h.count)).version,4);assert.deepEqual(h.snapshot(),latest,'Historical replay returns current stock without overwriting later movement/configuration.');
 for(const change of [{amount:'800'},{unitId:'L'},{effectiveAt:'2026-01-02T01:00:00Z'},{actor:'other-manager'},{note:'Other note'},{productId:'other'},{expectedVersion:2}])await rejectsCode(h.service.recordCount({...h.count,...change}),'operation_conflict');
 assert.deepEqual(h.snapshot(),latest);await rejectsCode(h.service.recordCount({...h.count,operationId:'old-count',expectedVersion:4}),'invalid_time');
 assert.deepEqual(h.snapshot(),latest,'Conflicting replay and backdated entry preserve the original reconciliation and exact history.');h.sql.close();
}
{
 const custom={kind:'custom',id:'scoop',label:'scoop',dimension:'count',numerator:'2',denominator:'1'};
 const h=await fixture(custom),original={...h.count,amount:'1'};await h.service.recordCount(original);
 await h.service.recordMovement({companyId:'a',productId:'milk',operationId:'later-custom-receive',expectedVersion:2,actor:h.count.actor,action:'receive',amount:'1',unitId:'scoop',effectiveAt:'2026-01-03T00:00:00Z',note:''});
 await h.configure({operationId:'custom-v2',stockUnit:{...custom,numerator:'3',denominator:'2'},openingAmount:undefined,effectiveAt:'2026-01-04T00:00:00Z'});
 const latest=h.snapshot();const replay=await h.service.recordCount(original);assert.equal(replay.onHand.minor,'4');assert.equal(replay.version,4);assert.deepEqual(h.snapshot(),latest,'Saved scoop stays valid even though the new factor would produce fractional pieces.');
 await rejectsCode(h.service.recordCount({...original,expectedVersion:2}),'operation_conflict');h.sql.close();
}
{
 const h=await fixture(),input={companyId:'a',productId:'milk',operationId:'package-count',configId:'config-1',expectedVersion:1,actor:h.count.actor,action:'count',quantity:{packages:'1',remainder:'0',remainderUnitId:'mL'},effectiveAt:'2026-01-02T00:00:00Z',note:'Package count'};
 await recordPackageStock(h.db,input);await h.configure({operationId:'new-package',purchaseAmount:'2000',openingAmount:undefined,effectiveAt:'2026-01-03T00:00:00Z'});
 const saved=h.snapshot();assert.deepEqual(await recordPackageStock(h.db,input),{productId:'milk'});assert.deepEqual(h.snapshot(),saved,'Package receipt confirms before checking today\'s configuration.');
 await rejectsCode(recordPackageStock(h.db,{...input,quantity:{...input.quantity,packages:'2'}}),'operation_conflict');h.sql.close();
}

const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const response=await POST(new Request(`http://localhost${req.url}`,{method:'POST',headers:{'Content-Type':'application/json'},body}));res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin=`http://127.0.0.1:${server.address().port}`;
async function save(input){const {actor,...body}=input;const response=await fetch(origin+'/api/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'countExact',...body})});return {status:response.status,body:await response.json()};}
try{
 const h=await fixture();h.db.metadata='positive';const saved=await race(h,{...h.count,amount:'800'},save);
 assert.equal(saved.winner.value.status,200);assert.equal(saved.loser.value.status,409);assert.equal(saved.loser.value.body.code,'operation_conflict');
 const before=h.snapshot();globalThis.bug06User=null;assert.equal((await save(h.count)).status,401);globalThis.bug06User={userId:'manager',email:h.count.actor};
 assert.equal((await save({...h.count,companyId:'b'})).status,403);globalThis.bug06Role='employee';assert.equal((await save(h.count)).status,403);globalThis.bug06Role='manager';
 assert.deepEqual(h.snapshot(),before,'Rejected API writes cannot change stock or count history.');
 assert.equal((await save({...h.count,expectedVersion:2})).status,409);assert.equal((await save(h.count)).status,200);
 assert.deepEqual(h.snapshot(),before);assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);h.sql.close();
}finally{await new Promise(ok=>server.close(ok));}
console.log('PASS: real count service/HTTP API rejects conflicting races for every identity field, confirms identical/lost/historical/custom/package replay, ignores misleading metadata, protects chronology/history and enforces company roles.');
