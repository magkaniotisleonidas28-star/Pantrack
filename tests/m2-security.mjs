import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';

mkdirSync('.sites-runtime',{recursive:true});
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
globalThis.m2db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.m2env={APP_ORIGIN:'https://test',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',AUTH_ENCRYPTION_KEY:'ab'.repeat(32)};
globalThis.m2headers=new Headers();
const plugin={name:'m2-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$|^next\/headers$|^next\/navigation$|db\/raw$/},a=>({path:a.path,namespace:'m2'}));b.onLoad({filter:/.*/,namespace:'m2'},a=>({contents:a.path==='next/headers'?'export async function headers(){return globalThis.m2headers}':a.path==='next/navigation'?'export function redirect(path){throw new Error(path)}':a.path==='cloudflare:workers'?'export const env=globalThis.m2env':'export function database(){return globalThis.m2db}'}));}};
const modules={};
for(const [name,path] of [...['companies','workspace','inventory','sales','register','clover','payments','automation','members','auth','clover/callback','register/ingest','automation/tick'].map(n=>[n,'src/app/api/'+n+'/route.ts']),['authlib','src/lib/auth.ts'],['authorization','src/lib/authorization.ts']]){
 const out='.sites-runtime/m2-'+name.replaceAll('/','-')+'.mjs';await build({entryPoints:[path],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[plugin]});modules[name]=await import('../'+out);
}
const accounts=Object.fromEntries(['owner','manager','employee','other','invitee'].map(name=>[name,{id:crypto.randomUUID(),email:name+'@example.test',email_confirmed_at:new Date().toISOString()}]));
const tokens=new Map();let failProvider=false;
globalThis.fetch=async(url,init={})=>{
 assert.ok(String(url).startsWith('https://test.supabase.co/auth/v1/'),'Only fake Supabase requests are allowed');
 if(failProvider)return Response.json({error:'offline'},{status:503});
 const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):{},token=init.headers?.Authorization?.slice(7);
 if(path.endsWith('/user')){
   if(!tokens.has(token))return Response.json({error:'expired'},{status:401});
   return Response.json(tokens.get(token));
 }
 if(path.endsWith('/token')){
   const user=Object.values(accounts).find(u=>u.email===body.email);
   if(!user||body.password!=='correct-password')return Response.json({error:'bad'},{status:400});
   const access_token=crypto.randomUUID();tokens.set(access_token,user);return Response.json({access_token,expires_in:3600});
 }
 if(path.endsWith('/verify')){
   if(body.token_hash!=='valid-recovery')return Response.json({error:'replay'},{status:400});
   tokens.set('recovery-token',accounts.owner);return Response.json({access_token:'recovery-token',expires_in:3600});
 }
 if(path.endsWith('/logout'))return new Response(null,{status:204});
 return Response.json({});
};
function req(name,method='GET',body, cookie='',extra={}){const headers=new Headers({'Content-Type':'application/json',Origin:'https://test',...extra});if(cookie)headers.set('Cookie',cookie);globalThis.m2headers=headers;return new Request('https://test/api/'+name+(method==='GET'?'?companyId=company-a':''),{method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})});}
async function call(name,method='GET',body,cookie='',extra={}){return modules[name][method](req(name,method,body,cookie,extra));}
async function login(name){const r=await call('auth','POST',{action:'signin',email:accounts[name].email,password:'correct-password'});assert.equal(r.status,200,await r.clone().text());const cookie=r.headers.get('set-cookie');assert.match(cookie,/__Host-pantrack=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);return cookie.split(';')[0];}
const cookies={};for(const name of Object.keys(accounts))cookies[name]=await login(name);
assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM auth_sessions').all()).includes([...tokens.keys()][0]),'Provider tokens encrypted at rest');
sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('company-a','A','now');sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('company-b','B','now');
for(const name of ['owner','manager','employee'])sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(accounts[name].id,'company-a',name);
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(accounts.other.id,'company-b','owner');
sql.prepare('INSERT INTO products VALUES (?,?,?)').run('company-a','milk',JSON.stringify({id:'milk',name:'Milk'}));
sql.prepare('INSERT INTO orders VALUES (?,?,?,?)').run('company-a','private-order',JSON.stringify({id:'private-order'}),'now');
const families=['workspace','inventory','sales','register','clover','payments','automation','members'];
const actions={workspace:['product','prepare','remove'],inventory:['settings','count','receive','use','waste','incoming','configureExact','movementExact','countExact','saveRecipeDraftExact','activateRecipeExact','archiveRecipeExact','saveModifierDraftExact','activateModifierExact','archiveModifierExact'],sales:['recipe','import','mapping','removeMapping'],register:['save','token','revoke'],clover:['connect','disconnect','menu'],payments:['setup','default','remove','verify'],automation:['vendor','policy','test','run','approve','reconcile','dismiss','received','scheduler','pause'],members:['invite','role','remove','transfer','revoke','cancelTransfer']};
for(const family of families){
 assert.equal((await call(family)).status,401,family+' anonymous read');
 assert.equal((await call(family,'POST',{companyId:'company-a'})).status,401,family+' anonymous write');
 assert.equal((await call(family,'GET',null,cookies.other)).status,403,family+' cross-company read');
 for(const action of actions[family]){
   const body={companyId:'company-a',action,...(family==='members'?{email:'new@example.test',role:'employee',userId:accounts.employee.id,id:crypto.randomUUID()}: {})};
   assert.equal((await call(family,'POST',body,cookies.other)).status,403,family+' cross-company '+action);
   assert.equal((await call(family,'POST',body,cookies.owner,{Origin:'https://evil.test'})).status,403,family+' CSRF '+action);
   // Members parse input before permission checks; use a valid role mutation below.
   if(family!=='members')assert.equal((await call(family,'POST',body,cookies.employee)).status,403,family+' employee '+action);
 }
}
// Membership actions require complete inputs before permission evaluation.
for(const role of ['manager','employee','other'])assert.equal((await call('members','POST',{companyId:'company-a',action:'remove',userId:accounts.employee.id},cookies[role])).status,403);
for(const family of ['companies',...families]){
 const r=await call(family,'POST',{action:family==='companies'?'create':'pause',id:crypto.randomUUID(),name:'No',companyId:'company-a'},cookies.owner,{Origin:''});assert.equal(r.status,403,'Missing Origin: '+family);
}
for(const role of ['owner','manager','employee']){
 for(const family of ['workspace','inventory','sales','register'])assert.equal((await call(family,'GET',null,cookies[role])).status,200,role+' reads '+family);
 for(const family of ['clover','payments'])assert.equal((await call(family,'GET',null,cookies[role])).status,role==='owner'?200:403,role+' reads '+family);
 assert.equal((await call('automation','GET',null,cookies[role])).status,role==='employee'?403:200);
}
assert.equal((await(await call('inventory','GET',null,cookies.owner)).json()).exactEnabled,false,'Exact inventory is dark by default.');
globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW='enabled';
const exactConfigure={companyId:'company-a',action:'configureExact',productId:'milk',operationId:'config-milk',stockUnit:{kind:'curated',id:'mL'},purchaseUnitLabel:'carton',purchaseAmount:'1000',openingAmount:'10',effectiveAt:'2026-01-01T00:00:00Z'};
assert.equal((await call('inventory','POST',exactConfigure,cookies.employee)).status,403,'Employees cannot mutate exact inventory.');
assert.equal((await call('inventory','POST',{...exactConfigure,companyId:'company-b'},cookies.manager)).status,403,'Managers cannot mutate another company.');
assert.equal((await call('inventory','POST',exactConfigure,cookies.manager)).status,200,'Managers can classify company inventory when the preview is enabled.');
assert.equal(sql.prepare("SELECT count(*) AS count FROM security_audit WHERE company_id='company-a' AND action='inventory.succeeded' AND target='configureExact'").get().count,1,'Exact inventory mutation is audited.');
assert.equal((await(await call('inventory','GET',null,cookies.employee)).json()).exact.records.length,1,'Employees can read their company exact inventory.');
assert.equal((await call('sales','POST',{companyId:'company-a',action:'import',reference:'blocked-during-preview',lines:[{recipeId:crypto.randomUUID(),quantity:1}]},cookies.manager)).status,409,'Legacy sales deductions pause during exact preview.');
delete globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW;
assert.deepEqual((await(await call('workspace','GET',null,cookies.employee)).json()).orders,[]);
assert.equal((await(await call('workspace','GET',null,cookies.manager)).json()).orders.length,1);
assert.equal((await call('automation','POST',{companyId:'company-a',action:'pause'},cookies.manager)).status,200);
assert.equal((await call('automation','POST',{companyId:'company-a',action:'scheduler'},cookies.manager)).status,403);
assert.ok(!('policy' in await(await call('automation','GET',null,cookies.manager)).json()));
for(const family of ['register/ingest','automation/tick']){
 assert.equal((await call(family,'POST',{},cookies.owner)).status,401,'Session is not a machine credential');
 assert.equal((await call(family,'POST',{},'',{Authorization:'Bearer wrong'})).status,401);
}
assert.match((await call('clover/callback')).headers.get('location'),/failed/);
// Direct hostile hosting headers never create identity.
assert.equal((await call('companies','GET',null,'',{'oai-authenticated-user-id':accounts.owner.id,'oai-authenticated-user-email':accounts.owner.email,'x-pantrack-local-stamp':String(Date.now()),'x-pantrack-local-signature':'ab'.repeat(32)})).status,401);
// A real second-company membership has its own role.
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(accounts.owner.id,'company-b','employee');
const list=await(await call('companies','GET',null,cookies.owner)).json();assert.equal(list.companies.length,2);assert.equal(list.companies.find(c=>c.id==='company-b').role,'employee');

async function invite(email=accounts.invitee.email,role='manager'){const r=await call('members','POST',{action:'invite',companyId:'company-a',email,role},cookies.owner);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function accept(token,cookie=cookies.invitee){return call('members','POST',{action:'accept',token},cookie);}
let invitation=await invite();
assert.ok(Math.abs(invitation.expires-Date.now()-7*86400000)<2000);
assert.equal(sql.prepare('SELECT token_hash FROM company_invitations WHERE id=?').get(invitation.id).token_hash,await modules.authlib.hash(invitation.token));
assert.equal((await accept(invitation.token,cookies.other)).status,409,'Wrong verified email');
assert.equal((await accept(invitation.token)).status,200);assert.equal((await accept(invitation.token)).status,409,'Single use');
assert.equal(sql.prepare('SELECT role FROM memberships WHERE user_id=?').get(accounts.invitee.id).role,'manager');
assert.equal((await call('members','POST',{action:'remove',companyId:'company-a',userId:accounts.invitee.id},cookies.owner)).status,200);
invitation=await invite();sql.prepare('UPDATE company_invitations SET expires=? WHERE id=?').run(Date.now()-1,invitation.id);assert.equal((await accept(invitation.token)).status,409);
invitation=await invite();await call('members','POST',{action:'revoke',companyId:'company-a',id:invitation.id},cookies.owner);assert.equal((await accept(invitation.token)).status,409);
const replaced=await invite();invitation=await invite();assert.equal((await accept(replaced.token)).status,409,'Reissue revokes old token');
const replay=await Promise.all([accept(invitation.token),accept(invitation.token)]);assert.deepEqual(replay.map(r=>r.status).sort(),[200,409],'Concurrent acceptance has one winner');
assert.equal((await call('members','POST',{action:'invite',companyId:'company-a',email:'x@example.test',role:'owner'},cookies.owner)).status,400,'No owner invitation escalation');
assert.equal((await call('members','POST',{action:'remove',companyId:'company-a',userId:accounts.owner.id},cookies.owner)).status,409);
assert.throws(()=>sql.prepare('DELETE FROM memberships WHERE user_id=? AND company_id=?').run(accounts.owner.id,'company-a'),/retain an owner/);
assert.throws(()=>sql.prepare("UPDATE memberships SET role='employee' WHERE user_id=? AND company_id=?").run(accounts.owner.id,'company-a'),/retain an owner/);
const ownerHash=await modules.authlib.hash(cookies.owner.split('=')[1]);
sql.prepare('UPDATE auth_sessions SET reauthenticated_at=? WHERE hash=?').run(Date.now()-301000,ownerHash);
assert.equal((await call('members','POST',{action:'transfer',companyId:'company-a',userId:accounts.invitee.id},cookies.owner)).status,403,'Recent authentication required');
const reauth=await call('auth','POST',{action:'reauthenticate',password:'correct-password'},cookies.owner);assert.equal(reauth.status,200);const oldCookie=cookies.owner;cookies.owner=reauth.headers.get('set-cookie').split(';')[0];assert.equal((await call('companies','GET',null,oldCookie)).status,401,'Reauthentication rotates sessions');
const offer=await(await call('members','POST',{action:'transfer',companyId:'company-a',userId:accounts.invitee.id},cookies.owner)).json();assert.ok(offer.id);
const formerOwnerInvite=await invite(accounts.other.email);
assert.equal((await call('members','POST',{action:'acceptTransfer',companyId:'company-a',id:offer.id},cookies.employee)).status,409);
assert.equal((await call('members','POST',{action:'acceptTransfer',companyId:'company-a',id:offer.id},cookies.invitee)).status,200);
assert.equal(sql.prepare('SELECT role FROM memberships WHERE user_id=? AND company_id=?').get(accounts.owner.id,'company-a').role,'manager');
assert.equal(sql.prepare('SELECT role FROM memberships WHERE user_id=?').get(accounts.invitee.id).role,'owner');
assert.equal((await call('members','POST',{action:'acceptTransfer',companyId:'company-a',id:offer.id},cookies.invitee)).status,409,'Transfer cannot replay');
assert.equal((await call('payments','GET',null,cookies.owner)).status,403,'Demotion affects existing sessions');
assert.equal((await accept(formerOwnerInvite.token,cookies.other)).status,409,'Former owner invitations revoked');
assert.ok(sql.prepare("SELECT count(*) AS n FROM security_audit WHERE action='ownership.accepted'").get().n===1);
async function newOffer(){const r=await call('members','POST',{action:'transfer',companyId:'company-a',userId:accounts.manager.id},cookies.invitee);assert.equal(r.status,200);return r.json();}
let rejectedOffer=await newOffer();
await call('members','POST',{action:'cancelTransfer',companyId:'company-a',id:rejectedOffer.id},cookies.invitee);
assert.equal((await call('members','POST',{action:'acceptTransfer',companyId:'company-a',id:rejectedOffer.id},cookies.manager)).status,409,'Canceled ownership offer rejected');
rejectedOffer=await newOffer();sql.prepare('UPDATE ownership_transfers SET expires=0 WHERE id=?').run(rejectedOffer.id);
assert.equal((await call('members','POST',{action:'acceptTransfer',companyId:'company-a',id:rejectedOffer.id},cookies.manager)).status,409,'Expired ownership offer rejected');
// Logout replay, provider rejection, expiry, duplicate cookies, recovery isolation.
assert.equal((await call('auth','POST',{action:'signout'},cookies.employee)).status,200);assert.equal((await call('companies','GET',null,cookies.employee)).status,401);
sql.prepare('UPDATE auth_sessions SET expires=0 WHERE user_id=?').run(accounts.manager.id);assert.equal((await call('companies','GET',null,cookies.manager)).status,401);
assert.equal((await call('companies','GET',null,cookies.owner+'; '+cookies.owner)).status,401);
failProvider=true;assert.equal((await call('companies','GET',null,cookies.owner)).status,401);failProvider=false;
const outageCookie=await login('other');failProvider=true;
assert.equal((await call('auth','POST',{action:'signout'},outageCookie)).status,200,'Logout works during provider outage');
failProvider=false;assert.equal((await call('companies','GET',null,outageCookie)).status,401,'Outage logout cannot replay');
const providerExpired=await login('employee');tokens.clear();
assert.equal((await call('companies','GET',null,providerExpired)).status,401,'Provider-expired tokens rejected before D1 expiry');
cookies.owner=await login('owner');
const recovery=await call('auth','POST',{action:'verify',type:'recovery',token_hash:'valid-recovery'});assert.equal(recovery.status,200);const recoveryCookie=recovery.headers.get('set-cookie').split(';')[0];
assert.equal((await call('companies','GET',null,recoveryCookie)).status,401,'Recovery cannot access company data');
assert.equal((await call('auth','POST',{action:'password',password:'replacement-password'},cookies.owner)).status,403,'Only recovery sessions reset passwords');
assert.equal((await call('auth','POST',{action:'password',password:'replacement-password'},recoveryCookie)).status,200);
assert.equal((await call('companies','GET',null,cookies.owner)).status,401,'Recovery invalidates other sessions');
assert.equal(sql.prepare('SELECT count(*) AS n FROM auth_sessions WHERE user_id=?').get(accounts.owner.id).n,0);
accounts.other.email_confirmed_at='';
assert.equal((await call('auth','POST',{action:'signin',email:accounts.other.email,password:'correct-password'})).status,400,'Unconfirmed email rejected');
accounts.other.email_confirmed_at=new Date().toISOString();accounts.other.is_anonymous=true;
assert.equal((await call('auth','POST',{action:'signin',email:accounts.other.email,password:'correct-password'})).status,400,'Anonymous provider identity rejected');
delete accounts.other.is_anonymous;
assert.equal((await call('auth','POST',{action:'signin',email:accounts.other.email,password:'wrong'})).status,400,'Wrong password rejected');
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
console.log('PASS: M2 verified sessions, all API families, role/company isolation, CSRF, invitations/replay/concurrency, ownership protection, audit, logout, expiry and recovery. Supabase responses mocked; real provider setup remains a separate acceptance step.');
