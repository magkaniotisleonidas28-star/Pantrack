import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {workerFixture} from './helpers/po-cart-worker.mjs';
import {enqueue} from './helpers/po-cart-jobs.mjs';
const f=await workerFixture();f.options.clock={now:()=>new Date()};
globalThis.__sessionAPI={db:f.db,user:'manager',env:{PANTRACK_CART_PREVIEW:'enabled',PANTRACK_CART_WORKER_TRANSPORT:'enabled',PANTRACK_CART_BROWSER_LOCAL:'enabled'}};
for(const [name,entry] of [['manager','src/app/api/po-cart-jobs/route.ts'],['worker','src/app/api/internal/po-cart-browser-session/route.ts']])await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/session-'+name+'-api.mjs',plugins:[{name:'session-http',setup(b){
 b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|a8-review-source))$/},a=>({path:a.path,namespace:'session'}));b.onLoad({filter:/.*/,namespace:'session'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__sessionAPI.env;':a.path==='@/db/raw'?'export const database=()=>globalThis.__sessionAPI.db;':a.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__sessionAPI.user?{userId:globalThis.__sessionAPI.user}:null;':'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));}}]});
const manager=await import('../.sites-runtime/session-manager-api.mjs'),worker=await import('../.sites-runtime/session-worker-api.mjs'),origin='http://127.0.0.1:5181';
const m=body=>manager.POST(new Request(origin+'/api/po-cart-jobs?view=manager',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
const w=(c,body=null,query='',headers={},host=origin)=>{const request=new Request(host+'/api/internal/po-cart-browser-session'+query,{method:body?'POST':'GET',headers:{...(c?{authorization:'Bearer '+c.secret}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});return worker[body?'POST':'GET'](request);};
try{
 const a=await f.authorized(),q=await f.jobs().enqueue({...enqueue(a),browser:{layout:'rows',scenario:'login_expired'}}),j=q.current.job,c=f.credential({consumerKind:'local_browser'});
 const claim=await(await f.request(c,{action:'claim',jobId:j.id,operationId:randomUUID()})).json();await f.request(c,{action:'hold',jobId:j.id,fence:claim.receipt.fence,operationId:randomUUID(),reason:'sign_in_required'});
 const job=(await f.jobs().get({companyId:'a',jobId:j.id})).job,body={action:'requestBrowser',companyId:'a',jobId:j.id,expectedRevision:job.revision,operationId:randomUUID(),purpose:'sign_in'};
 for(const user of [null,'employee','b-manager']){globalThis.__sessionAPI.user=user;assert.equal((await m(body)).status,user?403:401);}globalThis.__sessionAPI.user='manager';
 assert.equal((await m({...body,companyId:'b'})).status,403);
 assert.equal((await m({...body,token:'private'})).status,400);
 globalThis.__sessionAPI.env.PANTRACK_CART_BROWSER_LOCAL='disabled';assert.equal((await m(body)).status,404);assert.equal((await w(c)).status,404);globalThis.__sessionAPI.env.PANTRACK_CART_BROWSER_LOCAL='enabled';
 const batch=f.db.batch.bind(f.db);let lost=false;f.db.batch=async statements=>{if(!lost&&statements.some(s=>s.query.startsWith('INSERT INTO po_cart_browser_operations'))){lost=true;f.db.loseAcknowledgment=true;}return batch(statements);};const response=await m(body);assert.equal(response.status,200);const saved=await response.json();assert.deepEqual(Object.keys(saved),['receipt']);assert.deepEqual(await(await m(body)).json(),saved);
 assert.equal((await w(null)).status,401);assert.equal((await w(f.credential())).status,403);assert.equal((await w(c,null,'',{'origin':origin})).status,403);
 assert.equal((await w(c,null,'?sessionId=x&sessionId=y')).status,400);assert.equal((await w(c,null,'?profile=x')).status,400);
 assert.equal((await w(c,null,'',{},'https://example.invalid')).status,404);
 const sessionId=f.sql.prepare('SELECT id FROM po_cart_browser_sessions').get().id,claimBody={action:'claim',sessionId,operationId:randomUUID()};
 assert.equal((await w(f.credential({companyId:'b',consumerKind:'local_browser'}),claimBody)).status,404);
 for(const extra of [{companyId:'a'},{profile:'private'},{fence:1},{cookie:'private'}])assert.equal((await w(c,{...claimBody,...extra})).status,400);
 assert.equal((await w(c,' '.repeat(32769))).status,413);
 const opened=await w(c,claimBody);assert.equal(opened.status,200,await opened.clone().text());assert.equal(opened.headers.get('cache-control'),'private, no-store');const result=await opened.json();assert.equal(result.current.session.state,'opening');assert.deepEqual((await(await w(c,claimBody)).json()).receipt,result.receipt);
 const projection=JSON.stringify(result);for(const key of ['secret','cookie','token','profile','observation','sessionUrl'])assert.ok(!projection.includes(key));
 // Revocation between preflight and transaction rejects heartbeat and retains the prior session revision.
 const revision=result.current.session.revision;f.db.beforeBatch=()=>f.revoke(c);
 const rejected=await w(c,{action:'heartbeat',sessionId,fence:result.current.session.fence,operationId:randomUUID()});assert.equal(rejected.status,401);assert.equal(f.sql.prepare('SELECT revision FROM po_cart_browser_sessions').get().revision,revision+1);assert.equal(f.sql.prepare('SELECT state FROM po_cart_browser_sessions').get().state,'closing');
}finally{f.sql.close();delete globalThis.__sessionAPI;}
console.log('PASS: manager session receipts/auth/role/company/default-off guards; authenticated scoped strict 32KiB session transport and transaction-time revocation.');
