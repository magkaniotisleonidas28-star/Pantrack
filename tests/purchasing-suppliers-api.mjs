import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture} from './helpers/supplier-simulation.mjs';
const f=await fixture();await f.source({productId:'item'});
globalThis.__registryApi={db:f.db,user:'manager',env:{PANTRACK_PO_DRAFT_PREVIEW:'enabled'},csrf:true};
await build({entryPoints:['src/app/api/purchasing-suppliers/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/registry-api.mjs',plugins:[{name:'registry-http',setup(b){
  b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/(chatgpt-auth|auth))$/},a=>({path:a.path,namespace:'registry-http'}));
  b.onLoad({filter:/.*/,namespace:'registry-http'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__registryApi.env;':
    a.path==='@/db/raw'?'export const database=()=>globalThis.__registryApi.db;':a.path==='@/lib/chatgpt-auth'?'export const getChatGPTUser=async()=>globalThis.__registryApi.user?{userId:globalThis.__registryApi.user}:null;':
    'export const csrf=()=>globalThis.__registryApi.csrf; export const audit=()=>({run:async()=>{}});',loader:'js'}));
}}]});
const api=await import('../.sites-runtime/registry-api.mjs');
const get=(company='a',query='')=>api.GET(new Request(`http://localhost/api/purchasing-suppliers?companyId=${company}${query}`));
const body={action:'save_profile',companyId:'a',operationId:'profile-create',supplierId:'supplier',expectedVersion:0,reason:'Fictional profile setup',profile:{name:'Fictional API supplier',email:null,telephone:'',paymentTerms:'',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'',notes:'',emailAcceptance:{status:'unknown',note:''},accounts:[{id:'account',reference:'A-001',status:'active'}],locations:[{id:'location',accountId:'account',reference:'Café',address:'123 Fictional Street',status:'active'}]}};
const post=data=>api.POST(new Request('http://localhost/api/purchasing-suppliers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}));
globalThis.__registryApi.user=null;assert.equal((await get()).status,401);assert.equal((await post(body)).status,401);
for(const user of ['employee','b-manager']){globalThis.__registryApi.user=user;assert.equal((await get()).status,403);assert.equal((await post(body)).status,403);}
globalThis.__registryApi.user='manager';assert.equal((await get('b')).status,403);
globalThis.__registryApi.env.PANTRACK_PO_DRAFT_PREVIEW='disabled';assert.equal((await get()).status,404);assert.equal((await post(body)).status,404);
globalThis.__registryApi.env.PANTRACK_PO_DRAFT_PREVIEW='enabled';globalThis.__registryApi.csrf=false;assert.equal((await post(body)).status,403);globalThis.__registryApi.csrf=true;
const saved=await post(body);assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);const supplier=(await saved.json()).supplier;
assert.deepEqual((await (await post(body)).json()).supplier,supplier);assert.equal((await post({...body,reason:'Different request'})).status,409);
assert.deepEqual((await (await get('a','&supplierId=supplier')).json()).supplier,supplier);
assert.equal((await (await get()).json()).suppliers.length,1);assert.equal((await get('a','&offset=-1')).status,400);
assert.equal((await get('a','&supplierId=foreign')).status,404);assert.equal((await get('a','&supplierId=supplier&version=bad')).status,400);
assert.equal((await get('a','&view=stocks')).status,200);assert.equal((await get('a','&view=units&productId=item')).status,200);
const map={action:'save_mapping',companyId:'a',operationId:'mapping-create',reason:'Fictional map setup',mappingId:'mapping',expectedVersion:0,supplierId:'supplier',expectedSupplierVersion:1,
  accountId:'account',locationId:'location',productId:'item',expectedConfigId:'config-item',expectedConfigVersion:1,sku:'SKU',description:'Item',unitLabel:'case',packAmount:'6',packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:null};
assert.equal((await post(map)).status,200);assert.equal((await get('a','&view=projection&mappingId=mapping')).status,200);
assert.equal((await get('a','&view=mappings&supplierId=supplier')).status,200);
assert.equal((await (await get('a','&view=history&mappingId=mapping')).json()).versions.length,1);
assert.equal((await post({...map,operationId:'zero',mappingId:'zero',packAmount:'0'})).status,400);
assert.equal((await post({...body,action:'send'})).status,400);assert.equal((await post({...body,action:'delete_profile'})).status,400);
globalThis.__registryApi.user='employee';for(const query of ['&supplierId=supplier','&view=history&supplierId=supplier','&mappingId=mapping','&view=projection&mappingId=mapping'])assert.equal((await get('a',query)).status,403);
assert.equal((await post({action:'archive_mapping',companyId:'a',operationId:'forbidden-archive',mappingId:'mapping',expectedVersion:1,reason:'Forbidden archive'})).status,403);
globalThis.__registryApi.user='owner';assert.equal((await post({action:'archive_profile',companyId:'a',operationId:'archive',supplierId:'supplier',expectedVersion:1,reason:'No longer used'})).status,200);
assert.equal((await get('a','&view=projection&mappingId=mapping')).status,409);assert.equal((await (await get('a','&view=history&supplierId=supplier')).json()).versions.length,2);
f.sql.close();delete globalThis.__registryApi;
console.log('PASS: registry route anonymous/company/role/CSRF/default-off gates, private profile/mapping/history/projection endpoints, strict commands, exact replay and retained archives.');
