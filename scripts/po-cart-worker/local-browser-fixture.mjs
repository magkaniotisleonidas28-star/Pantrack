import '../sites-env.mjs';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixtureCredential} from './credentials.mjs';
import {writePrivate,readPrivate} from './private-files.mjs';
export async function seedLocalBrowserJob({layout='rows',scenario='normal',enqueueJob=true,root='.sites-runtime/po-cart-workers/served-browser-'+randomUUID()}={}){
 const origin='http://127.0.0.1:5181';mkdirSync(root,{recursive:true,mode:0o700});
 const signed=await fetch(origin+'/signin-with-chatgpt?return_to=/',{redirect:'manual'}),cookie=signed.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw Error('Start pnpm dev:cart-browser-worker first.');
 async function request(path,body){const r=await fetch(origin+path,body?{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)}:{headers:{cookie}});
  if(r.status!==200)throw Error('Fictional manager fixture request failed.');return r.json();}
 async function execute(sql){const file=root+'/fixture.sql';writeFileSync(file,sql,{mode:0o600});
  try{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','.sites-runtime/cart-review-config/wrangler.jsonc','--persist-to','.sites-runtime/cart-review-state','--file',file],{encoding:'utf8'});
   if(r.status!==0)throw Error('Local D1 fixture setup failed.');}finally{unlinkSync(file);}}
 const quote=v=>`'${String(v).replaceAll("'","''")}'`,companyId=randomUUID(),supplier={id:'cart-demo-supplier',name:'Fictional cart',email:'orders@example.invalid',accountId:'DEMO-CART',locationId:'DEMO-CAFE',deliveryAddress:'123 Example Street'};
 await request('/api/companies',{action:'create',id:companyId,name:enqueueJob?'Fictional browser worker acceptance':'Durable cart practice café'});const inventory=await request('/api/inventory?companyId='+companyId);
 const connection={companyId,id:'browser-worker-local',version:1,supplierId:supplier.id,accountId:supplier.accountId,locationId:supplier.locationId,mode:'fictional',status:'active',paused:false};
 await execute(`INSERT INTO po_cart_connections VALUES(${quote(companyId)},${quote(connection.id)},1,${quote(JSON.stringify(connection))});\nINSERT INTO po_cart_budget_policies VALUES(${quote(companyId)},1,50000,100000);`);
 const output=resolve(root,'fixture-module.mjs');await build({stdin:{contents:"export * from './scripts/po-cart-worker/fixture-store.ts';export * from './scripts/cart-preview/fixture.ts';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:output,logLevel:'silent'});
 const {BrowserFixtureStore,catalog}=await import(pathToFileURL(output).href);
 let {order}=await request('/api/purchase-orders',{action:'create',companyId,operationId:randomUUID(),source:'manual',supplier,capMinor:'25000',notes:'Private fictional browser acceptance',lines:catalog.map((l,i)=>({kind:'non_stock',sku:l.sku,description:l.description,unitLabel:l.unitLabel,packs:String(i+1),estimatedUnitMinor:l.unitMinor}))});
 ({order}=await request('/api/purchase-orders',{action:'review',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:randomUUID(),acknowledgeWarnings:true}));
 const permission=enqueueJob?await request('/api/po-cart-authorizations',{action:'authorize',companyId,orderId:order.snapshot.id,expectedRevision:order.revision,operationId:randomUUID()}):null;
 const queued=permission?await request('/api/po-cart-jobs',{action:'enqueue',companyId,authorizationId:permission.current.authorization.id,expectedRevision:1,operationId:randomUUID(),browser:{layout,scenario}}):null,jobId=queued?.current.job.id;
 const storefrontFile='.sites-runtime/po-cart-workers/local-storefront.json',store=new BrowserFixtureStore(storefrontFile),session=jobId?store.provision(jobId,{layout,scenario}):null;
 const fixtureFile=root+'/sessions.json';writePrivate(fixtureFile,{version:1,origin:'http://127.0.0.1:5182',jobs:jobId?{[jobId]:{scope:{companyId,supplierId:supplier.id,accountId:supplier.accountId},layout,scenario,token:session.token}}:{}});
 const credentialFiles=[root+'/one.json',root+'/two.json'];for(const file of credentialFiles)await fixtureCredential({execute,file,companyId,consumerKind:'local_browser'});
 const manifest={origin,root,companyId,orderId:order.snapshot.id,jobId,fixtureFile,credentialFiles,layout,scenario};writePrivate(root+'/manifest.json',manifest);
 return {...manifest,request,execute,inventory,reservation:permission?.current.reservation,storefrontFile,readSession:()=>readPrivate(storefrontFile).fixtures[jobId]};
}
