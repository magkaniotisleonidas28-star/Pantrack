import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
// Requires dev:purchase-orders. Only the isolated localhost fixture server is used.
const origin='http://127.0.0.1:5179';
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=signed.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Fictional fixture sign-in');
const companyId=crypto.randomUUID();
async function post(path,body){const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
async function get(path){const response=await fetch(origin+path,{headers:{cookie}});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;}
await post('/api/companies',{action:'create',id:companyId,name:'Fictional supplier registry review'});
assert.equal((await fetch(origin+`/api/purchasing-suppliers?companyId=${companyId}`)).status,401);
assert.equal((await fetch(origin+`/api/purchasing-suppliers?companyId=${crypto.randomUUID()}`,{headers:{cookie}})).status,403);
assert.equal((await fetch(origin+'/api/purchasing-suppliers',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({companyId,action:'save_profile'})})).status,403);
const productId=crypto.randomUUID();
await post('/api/inventory',{action:'createStockExact',companyId,productId,operationId:crypto.randomUUID(),name:'Fictional milk each',
  stockUnit:{kind:'curated',id:'each'},purchaseUnitLabel:'item',purchaseAmount:'1',purchaseContentUnitId:'each',openingAmount:'0',effectiveAt:new Date().toISOString()});
const stock=(await get(`/api/purchasing-suppliers?companyId=${companyId}&view=stocks`)).stocks.find(s=>s.product_id===productId);
const profile={name:'Fictional Six Supplier',email:null,telephone:'',paymentTerms:'Fictional net 30',minimumOrderMinor:null,deliveryFeeMinor:null,orderingInstructions:'Illustrative Wednesday delivery',notes:'Fictional fixture only',emailAcceptance:{status:'unknown',note:''},
  accounts:[{id:'account',reference:'DEMO-001',status:'active'}],locations:[{id:'location',accountId:'account',reference:'Practice café',address:'123 Fictional Street',status:'active'}]};
const supplierIds=[crypto.randomUUID(),crypto.randomUUID()],mappingIds=[crypto.randomUUID(),crypto.randomUUID()],orderIds=[];
const inventoryBefore=await get(`/api/inventory?companyId=${companyId}`);
for(const [i,packs] of ['6','12'].entries()){
  const supplier=(await post('/api/purchasing-suppliers',{action:'save_profile',companyId,operationId:crypto.randomUUID(),supplierId:supplierIds[i],expectedVersion:0,reason:'Fictional profile setup',
    profile:{...profile,name:i?'Fictional Twelve Supplier':profile.name}})).supplier;
  const mapping=(await post('/api/purchasing-suppliers',{action:'save_mapping',companyId,operationId:crypto.randomUUID(),mappingId:mappingIds[i],expectedVersion:0,reason:'Fictional pack setup',
    supplierId:supplier.id,expectedSupplierVersion:1,accountId:'account',locationId:'location',productId,expectedConfigId:stock.config_id,expectedConfigVersion:stock.config_version,
    sku:`MILK-${packs}`,description:'Fictional milk',unitLabel:'case',packAmount:packs,packUnitId:'each',packUnitVersion:1,estimatedUnitMinor:i?'1000':null})).mapping;
  assert.equal(mapping.stockUnitsPerPack.minor,packs);
  const command={action:'create',source:'registry',companyId,operationId:crypto.randomUUID(),supplierRef:{id:supplier.id,version:1,accountId:'account',locationId:'location'},
    capMinor:'10000',notes:'Fictional local draft — not sent',lines:[{kind:'stock',mappingId:mapping.id,mappingVersion:1,packs:'2'}]};
  const order=(await post('/api/purchase-orders',command)).order;orderIds.push(order.snapshot.id);
  assert.equal(order.snapshot.lines[0].stockQuantity.minor,(BigInt(packs)*BigInt(2)).toString());
  assert.deepEqual((await post('/api/purchase-orders',command)).order,order);
  await post('/api/purchasing-suppliers',{action:'save_profile',companyId,operationId:crypto.randomUUID(),supplierId:supplier.id,expectedVersion:1,reason:'Fictional later address edit',
    profile:{...supplier.profile,locations:supplier.profile.locations.map(l=>({...l,address:'456 Later Fictional Street'}))}});
  assert.deepEqual((await get(`/api/purchase-orders?companyId=${companyId}&orderId=${order.snapshot.id}`)).order,order);
}
assert.deepEqual(await get(`/api/inventory?companyId=${companyId}`),inventoryBefore);
assert.equal((await get(`/api/purchasing-suppliers?companyId=${companyId}&view=history&supplierId=${supplierIds[0]}`)).versions.length,2);
writeFileSync('.sites-runtime/supplier-browser-fixture.json',JSON.stringify({companyId,productId,supplierIds,mappingIds,orderIds}));
console.log('PASS: served local registry anonymous/company/CSRF checks, supplier-specific 6/12 packs, replay, frozen drafts after profile edits, history and unchanged inventory.');
