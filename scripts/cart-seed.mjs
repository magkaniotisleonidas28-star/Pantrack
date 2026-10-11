import {writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:5181';
const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'}),cookie=signed.headers.get('set-cookie')?.split(';')[0];
if(!cookie)throw Error('Start pnpm dev:cart first.');
const call=async(path,body)=>{const r=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Error(data.error??'Fixture setup failed.');return data;};
const companyId=crypto.randomUUID();await call('/api/companies',{action:'create',id:companyId,name:'Cart practice café'});
const draft={action:'create',companyId,operationId:crypto.randomUUID(),source:'manual',supplier:{id:'cart-demo-supplier',name:'Fictional cart supplier',email:'orders@example.invalid',accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'},capMinor:'50000',notes:'Fictional cart preparation only',lines:[
  {kind:'non_stock',sku:'DEMO-COFFEE',description:'House coffee beans',unitLabel:'case of 6 × 1 lb',packs:'2',estimatedUnitMinor:'5400'},
  {kind:'non_stock',sku:'DEMO-OAT',description:'Barista oat milk',unitLabel:'case of 12 × 1 L',packs:'3',estimatedUnitMinor:'3200'},
  {kind:'non_stock',sku:'DEMO-CUPS',description:'12 oz paper cups',unitLabel:'sleeve of 50',packs:'4',estimatedUnitMinor:'650'},
]};
const {order}=await call('/api/purchase-orders',draft);
await call('/api/purchase-orders',{action:'review',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:crypto.randomUUID(),acknowledgeWarnings:true});
writeFileSync('.sites-runtime/cart-review-fixture.json',JSON.stringify({companyId,orderId:order.snapshot.id}),{mode:0o600});
console.log('Created Cart practice café with a reviewed fictional draft. Sign in locally at http://127.0.0.1:5181/signin-with-chatgpt?return_to=/, select Cart practice café, and open Purchase-order drafts.');
