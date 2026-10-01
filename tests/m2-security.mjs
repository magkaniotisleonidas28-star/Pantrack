import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';

mkdirSync('.sites-runtime',{recursive:true});
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
globalThis.m2db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const statement=sql.prepare(query);if(/^\s*SELECT\b/i.test(query))return {results:statement.all(...values),meta:{changes:0}};const r=statement.run(...values);return {results:[],meta:{changes:Number(r.changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.m2env={APP_ORIGIN:'https://test',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test',AUTH_ENCRYPTION_KEY:'ab'.repeat(32)};
globalThis.m2headers=new Headers();
const plugin={name:'m2-runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$|^next\/headers$|^next\/navigation$|db\/raw$/},a=>({path:a.path,namespace:'m2'}));b.onLoad({filter:/.*/,namespace:'m2'},a=>({contents:a.path==='next/headers'?'export async function headers(){return globalThis.m2headers}':a.path==='next/navigation'?'export function redirect(path){throw new Error(path)}':a.path==='cloudflare:workers'?'export const env=globalThis.m2env':'export function database(){return globalThis.m2db}'}));}};
const modules={};
for(const [name,path] of [...['companies','workspace','inventory','sales','sales/events','register','clover','payments','automation','members','auth','clover/callback','register/ingest','automation/tick','replenishment/review','replenishment/proposals','waste','waste/shortcuts','waste/items','waste/entries','waste/sales','waste/setup','waste/review'].map(n=>[n,'src/app/api/'+n+'/route.ts']),['authlib','src/lib/auth.ts'],['authorization','src/lib/authorization.ts'],['passwordPolicy','src/lib/password-policy.ts']]){
 const out='.sites-runtime/m2-'+name.replaceAll('/','-')+'.mjs';await build({entryPoints:[path],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[plugin]});modules[name]=await import('../'+out);
}
const accounts=Object.fromEntries(['owner','manager','employee','other','invitee'].map(name=>[name,{id:crypto.randomUUID(),email:name+'@example.test',email_confirmed_at:new Date().toISOString()}]));
const tokens=new Map(),providerRequests=new Map();let failProvider=false;
globalThis.fetch=async(url,init={})=>{
 assert.ok(String(url).startsWith('https://test.supabase.co/auth/v1/'),'Only fake Supabase requests are allowed');
 assert.equal(init.redirect,'manual','Supabase requests must not follow redirects in Workers');
 if(failProvider)return Response.json({error:'offline'},{status:503});
 const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):{},token=init.headers?.Authorization?.slice(7);
 providerRequests.set(path,(providerRequests.get(path)||0)+1);
 if(path.endsWith('/user')){
   if(!tokens.has(token))return Response.json({error:'expired'},{status:401});
   return Response.json(tokens.get(token));
 }
 if(path.endsWith('/token')){
   const user=Object.values(accounts).find(u=>u.email===body.email);
   if(!user||body.password!=='existingpassword')return Response.json({error:'bad'},{status:400});
   const access_token=crypto.randomUUID();tokens.set(access_token,user);return Response.json({access_token,expires_in:3600});
 }
 if(path.endsWith('/verify')){
   if(body.token_hash!=='valid-recovery')return Response.json({error:'replay'},{status:400});
   tokens.set('recovery-token',accounts.owner);return Response.json({access_token:'recovery-token',expires_in:3600});
 }
 if(path.endsWith('/logout'))return new Response(null,{status:204});
 return Response.json({});
};
function req(name,method='GET',body, cookie='',extra={}){const headers=new Headers({'Content-Type':'application/json',Origin:'https://test',...extra});if(cookie)headers.set('Cookie',cookie);globalThis.m2headers=headers;return new Request('https://test/api/'+name+(method==='GET'?'?companyId=company-a'+(name.startsWith('replenishment/')?'&productId=milk':''):''),{method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})});}
async function call(name,method='GET',body,cookie='',extra={}){return modules[name][method](req(name,method,body,cookie,extra));}
async function login(name){const r=await call('auth','POST',{action:'signin',email:accounts[name].email,password:'existingpassword'});assert.equal(r.status,200,await r.clone().text());const cookie=r.headers.get('set-cookie');assert.match(cookie,/__Host-pantrack=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);return cookie.split(';')[0];}
const cookies={};for(const name of Object.keys(accounts))cookies[name]=await login(name);
assert.equal(modules.passwordPolicy.isValidNewPassword('short!'),false,'New passwords require 12 characters.');
assert.equal(modules.passwordPolicy.isValidNewPassword('longpasswordonly'),false,'New passwords require a special character.');
assert.equal(modules.passwordPolicy.isValidNewPassword('longpässwordonly'),false,'Letters outside ASCII are not misclassified as special characters.');
assert.equal(modules.passwordPolicy.isValidNewPassword('valid-password!'),true,'Compliant new passwords are accepted.');
const signupRequests=providerRequests.get('/auth/v1/signup')||0;
assert.equal((await call('auth','POST',{action:'signup',email:'signup@example.test',password:'short!'})).status,400,'Signup rejects a password shorter than 12 characters.');
assert.equal((await call('auth','POST',{action:'signup',email:'signup@example.test',password:'longpasswordonly'})).status,400,'Signup rejects a missing special character before the provider.');
assert.equal(providerRequests.get('/auth/v1/signup')||0,signupRequests,'Invalid signup does not call the provider.');
assert.equal((await call('auth','POST',{action:'signup',email:'signup@example.test',password:'valid-password!'})).status,200,'Signup accepts a compliant new password.');
assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM auth_sessions').all()).includes([...tokens.keys()][0]),'Provider tokens encrypted at rest');
sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('company-a','A','now');sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('company-b','B','now');
for(const name of ['owner','manager','employee'])sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(accounts[name].id,'company-a',name);
sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(accounts.other.id,'company-b','owner');
sql.prepare('INSERT INTO products VALUES (?,?,?)').run('company-a','milk',JSON.stringify({id:'milk',name:'Milk'}));
sql.prepare('INSERT INTO orders VALUES (?,?,?,?)').run('company-a','private-order',JSON.stringify({id:'private-order'}),'now');
sql.prepare('INSERT INTO sales_imports(company_id,reference,data,created) VALUES (?,?,?,?)').run('company-a','fictional-legacy-reference',JSON.stringify({reference:'fictional-legacy-reference'}),'now');
sql.prepare('INSERT INTO register_mappings(company_id,external_key,data) VALUES (?,?,?)').run('company-a','fictional-register-reference',JSON.stringify({key:'fictional-register-reference'}));
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
const employeeRecipes=await(await call('sales','GET',null,cookies.employee)).json();
assert.deepEqual(employeeRecipes.imports,[],'Employees cannot read legacy import references.');
assert.deepEqual(employeeRecipes.mappings,[],'Employees cannot read register mapping identifiers.');
const managerRecipes=await(await call('sales','GET',null,cookies.manager)).json();
assert.equal(managerRecipes.imports[0].reference,'fictional-legacy-reference','Managers retain legacy import review data.');
assert.equal(managerRecipes.mappings[0].key,'fictional-register-reference','Managers retain register mapping review data.');
assert.equal((await call('sales/events')).status,401,'Sales event review denies anonymous reads.');
assert.equal((await call('sales/events','GET',null,cookies.other)).status,403,'Sales event review denies wrong-company reads.');
assert.equal((await call('sales/events','POST',{companyId:'company-a',action:'dismiss',eventKey:'missing',reason:'reviewed'},cookies.employee)).status,403,'Employees cannot mutate sales events.');
assert.equal((await call('sales/events','POST',{companyId:'company-b',action:'dismiss',eventKey:'missing',reason:'reviewed'},cookies.manager)).status,403,'Managers cannot mutate another company’s sales events.');
assert.equal((await call('sales/events','GET',null,cookies.employee)).status,200,'Employees may read safe sales status while the gate is dark.');
assert.equal((await(await call('inventory','GET',null,cookies.owner)).json()).exactEnabled,false,'Exact inventory is dark by default.');
assert.equal((await call('replenishment/review')).status,401,'Anonymous A8 review is denied.');
assert.equal((await call('replenishment/review','GET',null,cookies.other)).status,403,'Wrong-company A8 review is denied.');
assert.equal((await call('replenishment/review','GET',null,cookies.employee)).status,403,'Employees cannot inspect purchasing proposals.');
assert.equal((await call('replenishment/review','GET',null,cookies.manager)).status,404,'A8 review stays dark with exact preview off.');
const a8Create={action:'create',companyId:'company-a',productId:'milk',proposalId:crypto.randomUUID(),createId:crypto.randomUUID()};
const a8Edit={action:'edit',companyId:'company-a',proposalId:'missing-review',expectedRevision:1,changeId:crypto.randomUUID(),packs:'1',reason:'Fictional manager review'};
const a8Cancel={action:'cancel',companyId:'company-a',proposalId:'missing-review',expectedRevision:1,changeId:crypto.randomUUID(),reason:'Fictional manager review'};
assert.equal((await call('replenishment/proposals')).status,401,'Anonymous saved proposal reads are denied.');
assert.equal((await call('replenishment/proposals','GET',null,cookies.other)).status,403,'Wrong-company saved proposal reads are denied.');
assert.equal((await call('replenishment/proposals','GET',null,cookies.employee)).status,403,'Employees cannot inspect saved proposals.');
assert.equal((await call('replenishment/proposals','POST',a8Create,cookies.employee)).status,403,'Employees cannot save proposals.');
assert.equal((await call('replenishment/proposals','POST',a8Create,cookies.other)).status,403,'Wrong-company proposal saves are denied.');
for(const body of [a8Edit,a8Cancel]){
 assert.equal((await call('replenishment/proposals','POST',body,cookies.employee)).status,403,'Employees cannot change saved reviews.');
 assert.equal((await call('replenishment/proposals','POST',body,cookies.other)).status,403,'Wrong-company review changes are denied.');
}
assert.equal((await call('replenishment/proposals','POST',a8Create,cookies.manager,{Origin:'https://evil.test'})).status,403,'Proposal writes reject cross-site origins.');
assert.equal((await call('replenishment/proposals','GET',null,cookies.manager)).status,404,'Saved proposals stay dark with exact preview off.');
globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW='enabled';
const exactConfigure={companyId:'company-a',action:'configureExact',productId:'milk',operationId:'config-milk',stockUnit:{kind:'curated',id:'mL'},purchaseUnitLabel:'carton',purchaseAmount:'1000',openingAmount:'10',effectiveAt:'2026-01-01T00:00:00Z'};
assert.equal((await call('inventory','POST',exactConfigure,cookies.employee)).status,403,'Employees cannot mutate exact inventory.');
assert.equal((await call('inventory','POST',{...exactConfigure,companyId:'company-b'},cookies.manager)).status,403,'Managers cannot mutate another company.');
assert.equal((await call('inventory','POST',exactConfigure,cookies.manager)).status,200,'Managers can classify company inventory when the preview is enabled.');
assert.equal(sql.prepare("SELECT count(*) AS count FROM security_audit WHERE company_id='company-a' AND action='inventory.succeeded' AND target='configureExact'").get().count,1,'Exact inventory mutation is audited.');
assert.equal((await(await call('inventory','GET',null,cookies.employee)).json()).exact.records.length,1,'Employees can read their company exact inventory.');
const a8Preview=await call('replenishment/review','GET',null,cookies.manager);
assert.equal(a8Preview.status,200,'Manager may request a read-only A8 review.');
assert.deepEqual(await a8Preview.json(),{kind:'unavailable',reason:'settings_missing'},'Missing planning settings remain a reviewable unavailable result.');
const a8Saved=await call('replenishment/proposals','GET',null,cookies.manager);
assert.equal(a8Saved.status,200,'Manager may list company saved proposals.');
assert.deepEqual(await a8Saved.json(),{views:[]});
assert.equal((await call('replenishment/proposals','POST',a8Create,cookies.manager)).status,409,'Missing planning settings cannot create a durable proposal.');
assert.equal((await call('replenishment/proposals','POST',a8Edit,cookies.manager)).status,404,'Missing proposal cannot be edited.');
assert.equal((await call('replenishment/proposals','POST',a8Cancel,cookies.manager)).status,404,'Missing proposal cannot be canceled.');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM replenishment_proposal_origins').get().n,0,'Rejected proposal creation writes no origin.');
const a8Config=sql.prepare("SELECT id,version FROM inventory_config_versions WHERE company_id='company-a' AND product_id='milk' AND status='active'").get();
const a8Quantity=minor=>({dimension:'volume',minor:String(minor)});
const a8Settings={target:a8Quantity(20000000),capacity:a8Quantity(10000000000),dailyUse:a8Quantity(1000000),shelfDays:3650,countEveryDays:3650,minimumPacks:'0',orderMultiplePacks:'1',maximumPacks:'5'};
const a8Now=Date.now(),a8At=new Date(a8Now).toISOString(),a8Success=new Date(a8Now-60000).toISOString();
sql.prepare(`INSERT INTO replenishment_settings_versions
 (company_id,product_id,version,change_id,inventory_config_id,inventory_config_version,dimension,settings_json,changed_by,change_reason,changed_at)
 VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('company-a','milk',1,'a8-settings',a8Config.id,a8Config.version,'volume',JSON.stringify(a8Settings),accounts.manager.id,'Fictional A8 route review',a8At);
sql.prepare('INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0)')
 .run('company-a','fictional-merchant','sandbox','encrypted-fictional-placeholder',a8At,a8At);
sql.prepare('INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error,lease_until) VALUES (?,?,?,?,?,?,?,?,0)')
 .run('company-a','sandbox','fictional-merchant',a8Now-3600000,a8Now-60000,a8At,a8Success,null);
globalThis.m2env.PANTRACK_CLOVER_SYNC_ENABLED='enabled';globalThis.m2env.CLOVER_ENVIRONMENT='sandbox';
const a8Ready=await call('replenishment/review','GET',null,cookies.manager);
assert.equal(a8Ready.status,200);
assert.equal((await a8Ready.json()).snapshot.contract,'pantrack.replenishment-review.v2','Manager route produces a Clover-backed preview.');
const savedA8=await call('replenishment/proposals','POST',a8Create,cookies.manager);
assert.equal(savedA8.status,200,await savedA8.clone().text());
assert.equal((await savedA8.json()).view.handoff.supplierSubmissionAllowed,false);
assert.equal((await call('replenishment/proposals','POST',a8Create,cookies.manager)).status,200,'Create retry replays one saved origin.');
const a8Listed=await call('replenishment/proposals','GET',null,cookies.manager);
assert.equal((await a8Listed.json()).views.length,1,'Saved proposal can be reloaded by the manager.');
const positiveEdit={...a8Edit,proposalId:a8Create.proposalId};
const editedA8=await call('replenishment/proposals','POST',positiveEdit,cookies.manager);
assert.equal(editedA8.status,200,await editedA8.clone().text());
assert.equal((await editedA8.json()).view.revision,2,'Manager edit adds one audited revision.');
const positiveCancel={...a8Cancel,proposalId:a8Create.proposalId,expectedRevision:2};
const canceledA8=await call('replenishment/proposals','POST',positiveCancel,cookies.manager);
assert.equal(canceledA8.status,200,await canceledA8.clone().text());
assert.equal((await canceledA8.json()).view.status,'canceled');
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM replenishment_proposal_origins WHERE company_id='company-a'").get().n,1);
globalThis.m2env.PANTRACK_CLOVER_SYNC_ENABLED='';
assert.equal((await call('sales/events','GET',null,cookies.employee)).status,200,'Employees may read safe exact-sales status.');
const exactRecipeId=crypto.randomUUID(),exactDraftId=crypto.randomUUID();
assert.equal((await call('inventory','POST',{companyId:'company-a',action:'saveRecipeDraftExact',recipeId:exactRecipeId,draftId:exactDraftId,name:'Exact milk',ingredients:[{productId:'milk',amount:'1',unitId:'mL'}]},cookies.manager)).status,200,'Manager can save exact recipe draft.');
assert.equal((await call('inventory','POST',{companyId:'company-a',action:'activateRecipeExact',recipeId:exactRecipeId,versionId:exactDraftId,expectedActiveVersionId:null},cookies.manager)).status,200,'Manager can activate exact recipe.');
const confirmedSaleTime=new Date().toISOString();
const privateReference='fictional-customer@example.test',privateReason='Fictional private note: redacted@example.test';
const exactSale=await call('sales','POST',{companyId:'company-a',action:'import',source:'manual',reference:privateReference,occurredAt:confirmedSaleTime,lines:[{recipeId:exactRecipeId,quantity:1}]},cookies.manager);
assert.equal(exactSale.status,200,await exactSale.clone().text());assert.equal((await exactSale.json()).state,'applied','Manual exact sale applies through B4.');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='company-a' AND product_id='milk'").get().on_hand_minor,'9000000','B4 route deducts exact inventory.');
const exactEventKey=sql.prepare("SELECT event_key FROM sales_events WHERE company_id='company-a' AND external_order_id=?").get(privateReference).event_key;
assert.equal((await call('sales/events','POST',{companyId:'company-a',action:'requestCorrection',eventKey:exactEventKey,reason:privateReason},cookies.manager)).status,200,'Manager can request a reviewed correction.');
sql.prepare('INSERT INTO sales_event_conflicts(company_id,conflict_id,canonical_event_key,received_at,source_payload_sha256,external_event_id,external_order_id,revision,reason) VALUES (?,?,?,?,?,?,?,?,?)').run('company-a',crypto.randomUUID(),exactEventKey,confirmedSaleTime,'a'.repeat(64),'fictional-event',privateReference,1,privateReason);
const employeeSales=await(await call('sales/events','GET',null,cookies.employee)).json();
assert.deepEqual(employeeSales,{enabled:true,events:[{state:'applied',occurredAt:confirmedSaleTime}],conflicts:[],corrections:[]},'Employees receive only state and time, with no identities, references, reasons, or correction details.');
assert.ok(!JSON.stringify(employeeSales).includes(privateReference));assert.ok(!JSON.stringify(employeeSales).includes(privateReason));assert.ok(!JSON.stringify(employeeSales).includes(exactEventKey));
const employeeDetailHeaders=new Headers({Cookie:cookies.employee});globalThis.m2headers=employeeDetailHeaders;
assert.equal((await modules['sales/events'].GET(new Request('https://test/api/sales/events?companyId=company-a&eventKey='+encodeURIComponent(exactEventKey),{headers:employeeDetailHeaders}))).status,403,'Employees cannot read individual event history.');
const managerSales=await(await call('sales/events','GET',null,cookies.manager)).json();
assert.equal(managerSales.events[0].externalReference,privateReference,'Managers retain sale references for review.');
assert.equal(managerSales.corrections[0].reason,privateReason,'Managers retain correction reasons for review.');
assert.equal(managerSales.conflicts[0].reason,privateReason,'Managers retain conflict reasons for review.');
sql.prepare("UPDATE sales_event_states SET state='dismissed' WHERE company_id='company-a' AND event_key=?").run(exactEventKey);
const dismissedReplay={companyId:'company-a',action:'replay',eventKey:exactEventKey,reason:'Owner reviewed dismissal'};
assert.equal((await call('sales/events','POST',dismissedReplay)).status,401,'Anonymous users cannot replay dismissed events.');
assert.equal((await call('sales/events','POST',dismissedReplay,cookies.other)).status,403,'Other companies cannot replay dismissed events.');
assert.equal((await call('sales/events','POST',dismissedReplay,cookies.employee)).status,403,'Employees cannot replay dismissed events.');
const managerDismissedReplay=await call('sales/events','POST',dismissedReplay,cookies.manager);
assert.equal(managerDismissedReplay.status,403,await managerDismissedReplay.clone().text());
const ownerDismissedReplay=await call('sales/events','POST',dismissedReplay,cookies.owner);
assert.equal(ownerDismissedReplay.status,200,await ownerDismissedReplay.clone().text());
assert.equal(sql.prepare("SELECT state FROM sales_event_states WHERE company_id='company-a' AND event_key=?").get(exactEventKey).state,'applied','Owner replay resolves the event.');
assert.equal(sql.prepare("SELECT on_hand_minor FROM inventory_balances_exact WHERE company_id='company-a' AND product_id='milk'").get().on_hand_minor,'9000000','Replaying a previously applied idempotency key does not deduct stock twice.');
assert.equal((await call('sales','POST',{companyId:'company-a',action:'import',reference:'missing-confirmed-time',lines:[{recipeId:crypto.randomUUID(),quantity:1}]},cookies.manager)).status,400,'Exact sales imports require a manager-confirmed occurrence time.');
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
// W1 has a narrow permission, separate from general inventory writes.
for(const route of ['waste','waste/shortcuts']){
 assert.equal((await call(route)).status,401,route+' anonymous read');
 assert.equal((await call(route,'POST',{companyId:'company-a'})).status,401,route+' anonymous write');
 assert.equal((await call(route,'GET',null,cookies.other)).status,403,route+' wrong-company read');
 assert.equal((await call(route,'POST',{companyId:'company-a'},cookies.other)).status,403,route+' wrong-company write');
 assert.equal((await call(route,'POST',{companyId:'company-a'},cookies.owner,{Origin:'https://evil.test'})).status,403,route+' CSRF');
}
assert.equal((await call('waste/shortcuts','GET',null,cookies.employee)).status,403,'Employees cannot configure shortcuts.');
assert.equal((await call('waste/shortcuts','POST',{companyId:'company-a'},cookies.employee)).status,403,'Employees cannot save shortcuts.');
globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW='';
assert.equal((await call('waste','GET',null,cookies.employee)).status,404,'Waste is dark by default.');
assert.equal((await call('waste','POST',{companyId:'company-a'},cookies.employee)).status,404,'Dark waste writes are blocked.');
globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW='enabled';
const safeWaste=await(await call('waste','GET',null,cookies.employee)).json();
assert.deepEqual(Object.keys(safeWaste).sort(),['enabled','items','serverNow']);
assert.deepEqual(Object.keys(safeWaste.items[0]).sort(),['configId','name','productId','shortcutRevision','shortcuts','unitId','unitLabel','version']);
assert.ok(!/price|cost|actor|email|payment|audit|onHand/.test(JSON.stringify(safeWaste)),'Waste response excludes finances and other staff details.');
const wasteItem=safeWaste.items.find(i=>i.productId==='milk');
const shortcutRequest={companyId:'company-a',productId:'milk',configId:wasteItem.configId,expectedRevision:0,operationId:crypto.randomUUID(),shortcuts:[{label:'Small spill',amount:'1',unitId:'mL'}]};
assert.equal((await call('waste/shortcuts','POST',shortcutRequest,cookies.manager)).status,200,'Managers can configure company shortcuts.');
assert.equal((await call('waste/shortcuts','POST',shortcutRequest,cookies.manager)).status,200,'Shortcut retry is idempotent.');
const wasteRequest={companyId:'company-a',productId:'milk',operationId:crypto.randomUUID(),expectedVersion:wasteItem.version,amount:'1',unitId:'mL',effectiveAt:'2026-05-01T00:00:00Z',reason:'spilled',note:''};
assert.equal((await call('waste','POST',{...wasteRequest,actor:accounts.owner.id},cookies.employee)).status,400,'Client actor is rejected.');
assert.equal((await call('waste','POST',{...wasteRequest,action:'receive'},cookies.employee)).status,400,'Waste cannot be used for receipts.');
assert.equal((await call('waste','POST',{...wasteRequest,reason:'unknown'},cookies.employee)).status,400,'Reasons are required and validated.');
const savedWaste=await call('waste','POST',wasteRequest,cookies.employee);
assert.equal(savedWaste.status,200,await savedWaste.clone().text());
assert.match(savedWaste.headers.get('Cache-Control'),/no-store/);
assert.deepEqual(Object.keys((await savedWaste.json()).result).sort(),['amount','effectiveAt','operationId','productId','reason','unitId']);
assert.equal((await call('waste','POST',wasteRequest,cookies.employee)).status,200,'Staff can confirm a duplicate without another deduction.');
assert.equal((await call('waste','POST',{...wasteRequest,reason:'other'},cookies.employee)).status,409,'Changed duplicate reason is rejected.');
const wasteEvent=sql.prepare('SELECT actor,waste_reason FROM inventory_events_exact WHERE company_id=? AND id=?').get('company-a','movement:'+wasteRequest.operationId);
assert.equal(wasteEvent.actor,accounts.employee.id,'Waste actor is session-derived.');
assert.equal(wasteEvent.waste_reason,'spilled');
assert.equal(sql.prepare("SELECT count(*) AS n FROM security_audit WHERE company_id='company-a' AND action='waste.succeeded'").get().n,2,'Waste mutations are audited.');
assert.equal((await call('waste','POST',wasteRequest,'expired-cookie')).status,401,'Expired session never claims success.');
assert.equal((await call('inventory','POST',{companyId:'company-a',action:'movementExact',movement:'waste'},cookies.employee)).status,403,'Broad inventory writes remain forbidden.');

// W2 reuses narrow staff waste access, never broader inventory or finance access.
for(const [route,methods] of [['waste/items',['GET']],['waste/sales',['GET']],['waste/entries',['POST']],['waste/setup',['POST']],['waste/review',['GET','POST']]]) {
 for(const method of methods) {
  const body=method==='POST'?{companyId:'company-a'}:null;
  assert.equal((await call(route,method,body)).status,401,route+' anonymous '+method);
  assert.equal((await call(route,method,body,cookies.other)).status,403,route+' wrong company '+method);
  if(method==='POST')assert.equal((await call(route,method,body,cookies.owner,{Origin:'https://evil.test'})).status,403,route+' CSRF');
  if(route==='waste/setup'||route==='waste/review')assert.equal((await call(route,method,body,cookies.employee)).status,403,route+' forbidden employee '+method);
  globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW='';
  assert.equal((await call(route,method,body,cookies.owner)).status,404,route+' preview off');
  globalThis.m2env.PANTRACK_EXACT_INVENTORY_PREVIEW='enabled';
 }
}
const menuOptionsResponse=await call('waste/items','GET',null,cookies.employee);
assert.equal(menuOptionsResponse.status,200);assert.match(menuOptionsResponse.headers.get('Cache-Control'),/no-store/);
const menuOptions=await menuOptionsResponse.json();
assert.ok(!/price|cost|actor|email|payment|audit|onHand|supplier/.test(JSON.stringify(menuOptions)));
const menuRecipe=menuOptions.items.find(i=>i.kind==='recipe'&&i.id===exactRecipeId);
const menuRequest={companyId:'company-a',operationId:crypto.randomUUID(),sourceKind:'recipe',sourceId:exactRecipeId,sourceVersion:menuRecipe.version,quantity:1,reason:'end_of_day',note:'',mode:'unsold',effectiveAt:new Date().toISOString(),modifiers:[]};
for(const changed of [{actor:accounts.owner.id},{quantity:0.5},{reason:'unknown'},{mode:'receive'}])assert.equal((await call('waste/entries','POST',{...menuRequest,...changed},cookies.employee)).status,400,'Invalid/privileged menu fields rejected.');
const menuSaved=await call('waste/entries','POST',menuRequest,cookies.employee);
assert.equal(menuSaved.status,200,await menuSaved.clone().text());assert.match(menuSaved.headers.get('Cache-Control'),/no-store/);
assert.equal((await menuSaved.json()).result.status,'deducted');
assert.equal((await call('waste/entries','POST',menuRequest,cookies.employee)).status,200,'Menu retry applies once.');
assert.equal((await call('waste/entries','POST',{...menuRequest,note:'changed'},cookies.employee)).status,409);
assert.equal(sql.prepare('SELECT actor FROM waste_entries WHERE company_id=? AND id=?').get('company-a',menuRequest.operationId).actor,accounts.employee.id);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM security_audit WHERE company_id='company-a' AND action='waste.succeeded' AND target=?").get(menuRequest.operationId).n,2,'Menu save/retry audited by operation reference.');
assert.equal((await call('waste/entries','POST',menuRequest,'expired-cookie')).status,401,'Expired menu save cannot claim success.');
const menuSetup={companyId:'company-a',productId:'milk',offered:true,expectedRevision:0,operationId:crypto.randomUUID()};
assert.equal((await call('waste/setup','POST',menuSetup,cookies.manager)).status,200);
assert.equal((await call('waste/setup','POST',menuSetup,cookies.manager)).status,200);
assert.equal((await call('waste/review','GET',null,cookies.manager)).status,200);
const narrowSalesReq=req('waste/sales','GET',null,cookies.employee);const narrowSalesUrl=new URL(narrowSalesReq.url);narrowSalesUrl.searchParams.set('sourceKind','recipe');narrowSalesUrl.searchParams.set('sourceId',exactRecipeId);
const narrowSales=await modules['waste/sales'].GET(new Request(narrowSalesUrl,{headers:narrowSalesReq.headers}));assert.equal(narrowSales.status,200);
assert.ok(!JSON.stringify(await narrowSales.json()).includes(privateReference),'Sale choices do not expose provider references.');

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
const reauth=await call('auth','POST',{action:'reauthenticate',password:'existingpassword'},cookies.owner);assert.equal(reauth.status,200);const oldCookie=cookies.owner;cookies.owner=reauth.headers.get('set-cookie').split(';')[0];assert.equal((await call('companies','GET',null,oldCookie)).status,401,'Reauthentication rotates sessions');
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
assert.equal((await call('auth','POST',{action:'password',password:'longpasswordonly'},recoveryCookie)).status,400,'Recovery rejects a missing special character.');
assert.equal((await call('auth','POST',{action:'password',password:'replacement-password'},recoveryCookie)).status,200);
assert.equal((await call('companies','GET',null,cookies.owner)).status,401,'Recovery invalidates other sessions');
assert.equal(sql.prepare('SELECT count(*) AS n FROM auth_sessions WHERE user_id=?').get(accounts.owner.id).n,0);
accounts.other.email_confirmed_at='';
assert.equal((await call('auth','POST',{action:'signin',email:accounts.other.email,password:'existingpassword'})).status,400,'Unconfirmed email rejected');
accounts.other.email_confirmed_at=new Date().toISOString();accounts.other.is_anonymous=true;
assert.equal((await call('auth','POST',{action:'signin',email:accounts.other.email,password:'existingpassword'})).status,400,'Anonymous provider identity rejected');
delete accounts.other.is_anonymous;
assert.equal((await call('auth','POST',{action:'signin',email:accounts.other.email,password:'wrong'})).status,400,'Wrong password rejected');
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
console.log('PASS: M2 verified sessions, all API families, role/company isolation, CSRF, invitations/replay/concurrency, ownership protection, audit, logout, expiry and recovery. Supabase responses mocked; real provider setup remains a separate acceptance step.');
