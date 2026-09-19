import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

// In-memory company data and a fetch stub only. No real supplier is verified by this test.
mkdirSync('.sites-runtime',{recursive:true});
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort()){
 sql.exec(readFileSync('drizzle/'+file,'utf8'));
}
globalThis.testDB={
 prepare(query){
  let values=[];
  return {
   bind(...bindings){values=bindings;return this;},
   async run(){const result=sql.prepare(query).run(...values);return {meta:{changes:Number(result.changes)}};},
   async first(){return sql.prepare(query).get(...values)||null;},
   async all(){return {results:sql.prepare(query).all(...values)};}
  };
 },
 async batch(statements){
  sql.exec('BEGIN');
  try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}
  catch(error){sql.exec('ROLLBACK');throw error;}
 }
};
globalThis.testUser={userId:'owner',email:'owner@example.test'};
globalThis.testEnv={};
const plugin={name:'purchasing-safety-mocks',setup(builder){
 builder.onResolve({filter:/chatgpt-auth|db\/raw|^cloudflare:workers$/},args=>({path:args.path,namespace:'mock'}));
 builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path.includes('chatgpt-auth')
  ?'export async function getChatGPTUser(){return globalThis.testUser}'
  :args.path.includes('cloudflare:')?'export const env=globalThis.testEnv':'export function database(){return globalThis.testDB}'}));
}};
for(const [name,path] of [
 ['api','src/app/api/automation/route.ts'],
 ['tick','src/app/api/automation/tick/route.ts'],
 ['engine','src/lib/purchasing-engine.ts'],
 ['types','src/lib/automation-types.ts'],
 ['inventory','src/lib/inventory.ts']
]){
 await build({entryPoints:[path],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/purchasing-safety-'+name+'.mjs',plugins:[plugin]});
}
const api=await import('../.sites-runtime/purchasing-safety-api.mjs');
const tick=await import('../.sites-runtime/purchasing-safety-tick.mjs');
const engine=await import('../.sites-runtime/purchasing-safety-engine.mjs');
const {defaultPolicy,purchasingBlockReason}=await import('../.sites-runtime/purchasing-safety-types.mjs');
const {defaultSettings}=await import('../.sites-runtime/purchasing-safety-inventory.mjs');
const networkActions=[];
globalThis.fetch=async(_url,init)=>{
 const body=JSON.parse(init.body);
 networkActions.push(body.action);
 if(body.action==='status')return Response.json({status:'accepted',order_id:'mock-existing-order'});
 if(body.action==='capabilities')return Response.json({protocol:'pantrack.vendor.v1',quotes:true,orders:true,status_lookup:true,idempotency:true,enforces_max_total:true,no_substitutions:true});
 throw new Error('Unexpected external action in purchase-gate test: '+body.action);
};
function seed(companyId,mode){
 const now=new Date().toISOString(),vendorId=crypto.randomUUID();
 const policy={...defaultPolicy,mode,allowedProducts:['milk']};
 const vendor={id:vendorId,name:'Test supplier',website:'',endpoint:'https://connector.pantrack-sandbox.com/api',account:'dummy-account',deliveryAddress:'Dummy test address',notes:'Test fixture only',enabled:true,verified:true};
 const product={id:'milk',name:'Milk',supplier:vendor.name,sku:'TEST-MILK',pack:'10 units',unit:'case',price:100,category:'Dairy',url:'',sample:false};
 const record={productId:product.id,settings:{...defaultSettings,unitsPerPack:10,targetStock:100},onHand:20,incoming:0,lastCount:now,updated:now,version:1,estimatedUsed:0};
 sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run(companyId,'Test cafe',now);
 sql.prepare('INSERT INTO memberships(user_id,company_id,role) VALUES (?,?,?)').run('owner',companyId,'owner');
 sql.prepare('INSERT INTO automation_settings(company_id,data) VALUES (?,?)').run(companyId,JSON.stringify(policy));
 sql.prepare('INSERT INTO vendor_connections(company_id,id,data,secret) VALUES (?,?,?,?)').run(companyId,vendorId,JSON.stringify(vendor),'');
 sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run(companyId,product.id,JSON.stringify(product));
 sql.prepare('INSERT INTO inventory(company_id,product_id,data,version) VALUES (?,?,?,?)').run(companyId,product.id,JSON.stringify(record),record.version);
 return {policy,vendorId};
}
const review=seed('review-company','review');
seed('legacy-company','automatic');
seed('other-company','review');
const post=(body,companyId='review-company')=>api.POST(new Request('https://test/api/automation',{
 method:'POST',headers:{'Content-Type':'application/json','Origin':'https://test'},body:JSON.stringify({companyId,...body})
}));
const get=(companyId='review-company')=>api.GET(new Request('https://test/api/automation?companyId='+companyId));
const scheduled=(companyId,token)=>tick.POST(new Request('https://test/api/automation/tick?companyId='+companyId,{
 method:'POST',headers:{Authorization:'Bearer '+token}
}));
const jobs=companyId=>sql.prepare('SELECT * FROM purchasing_jobs WHERE company_id=?').all(companyId);
const savedPolicy=companyId=>JSON.parse(sql.prepare('SELECT data FROM automation_settings WHERE company_id=?').get(companyId).data);

// Verified connector and eligible product are intentionally insufficient to authorize purchases.
const rejected=await post({action:'policy',policy:{...review.policy,mode:'automatic'}});
assert.equal(rejected.status,400);
assert.equal((await rejected.json()).error,purchasingBlockReason);
assert.equal(savedPolicy('review-company').mode,'review');
assert.equal((await post({action:'policy',policy:review.policy})).status,200);
const initialState=await(await get()).json();
assert.equal(initialState.purchasingEnabled,false);
assert.equal(initialState.purchasingBlockReason,purchasingBlockReason);

// Review checks still produce explainable quantities locally without contacting a connector.
const result=await(await post({action:'run'})).json();
assert.equal(result.created,1);
const proposal=jobs('review-company')[0];
assert.equal(proposal.status,'review');
assert.equal(JSON.parse(proposal.data).items[0].quantity,8);
assert.equal(proposal.spend_day,null);
assert.deepEqual(networkActions,[]);

// Both the authorized API path and a direct engine caller are blocked before any network or spend.
const approval=await post({action:'approve',id:proposal.id});
assert.equal(approval.status,400);
assert.equal((await approval.json()).error,purchasingBlockReason);
await assert.rejects(engine.submit('review-company',proposal.id),{message:purchasingBlockReason});
assert.deepEqual(jobs('review-company')[0],proposal);
assert.deepEqual(networkActions,[]);

// Existing/malicious database configuration cannot bypass the hard gate via a scheduler.
assert.equal(savedPolicy('legacy-company').mode,'automatic');
const legacyState=await(await get('legacy-company')).json();
assert.equal(legacyState.policy.mode,'review');
assert.equal(legacyState.purchasingEnabled,false);
const schedulerResponse=await post({action:'scheduler'},'legacy-company');
assert.equal(schedulerResponse.status,200);
const {schedulerToken}=await schedulerResponse.json();
assert.equal((await scheduled('legacy-company','wrong-token')).status,401);
assert.equal((await scheduled('other-company',schedulerToken)).status,401);
const scheduledResult=await scheduled('legacy-company',schedulerToken);
assert.equal(scheduledResult.status,200);
assert.equal((await scheduledResult.json()).created,1);
const legacyProposal=jobs('legacy-company')[0];
assert.equal(legacyProposal.status,'review');
assert.equal(legacyProposal.spend_day,null);
assert.equal((await(await scheduled('legacy-company',schedulerToken)).json()).created,0);
assert.equal((await(await post({action:'run'},'legacy-company')).json()).created,0);
assert.equal(jobs('legacy-company').length,1);
await assert.rejects(engine.submit('legacy-company',legacyProposal.id),{message:purchasingBlockReason});
assert.deepEqual(jobs('legacy-company')[0],legacyProposal);
assert.deepEqual(networkActions,[]);

// Paused configuration still prevents proposals; company and role checks still precede actions.
assert.equal((await post({action:'policy',policy:{...review.policy,mode:'paused'}},'other-company')).status,200);
assert.equal((await(await post({action:'run'},'other-company')).json()).created,0);
assert.equal(jobs('other-company').length,0);
globalThis.testUser=null;
assert.equal((await get()).status,401);
assert.equal((await post({action:'approve',id:proposal.id})).status,401);
globalThis.testUser={userId:'outsider'};
assert.equal((await get()).status,403);
assert.equal((await post({action:'approve',id:proposal.id})).status,403);
for(const role of ['manager','employee']){
 sql.prepare('INSERT INTO memberships(user_id,company_id,role) VALUES (?,?,?)').run(role,'review-company',role);
 globalThis.testUser={userId:role};
 assert.equal((await post({action:'policy',policy:{...review.policy,mode:'automatic'}})).status,403);
 assert.equal((await post({action:'approve',id:proposal.id})).status,role==='manager'?400:403);
}
sql.prepare('INSERT INTO memberships(user_id,company_id,role) VALUES (?,?,?)').run('single-company-owner','other-company','owner');
globalThis.testUser={userId:'single-company-owner'};
assert.equal((await get('other-company')).status,200);
assert.equal((await get('review-company')).status,403);
assert.equal((await post({action:'approve',id:proposal.id},'review-company')).status,403);
globalThis.testUser={userId:'owner',email:'owner@example.test'};
assert.deepEqual(networkActions,[]);

// A capability check and reconciliation of an existing uncertain order remain read-only.
assert.equal((await post({action:'test',id:review.vendorId})).status,200);
sql.prepare("UPDATE purchasing_jobs SET status='unknown' WHERE company_id=? AND id=?").run('review-company',proposal.id);
const reconciled=await post({action:'reconcile',id:proposal.id});
assert.equal(reconciled.status,200);
assert.equal((await reconciled.json()).job.status,'accepted');
assert.deepEqual(networkActions,['capabilities','status']);
assert.equal(networkActions.includes('order'),false);
sql.close();
console.log('PASS: automatic mode rejection, review proposals, direct/API submission gate, legacy automatic scheduler safety, tenant/role access, and read-only mocked reconciliation. No real supplier or pilot was verified.');
