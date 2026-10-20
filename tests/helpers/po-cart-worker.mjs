import {build} from 'esbuild';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {jobFixture} from './po-cart-jobs.mjs';
export const workerOrigin='http://127.0.0.1:5194';
export async function workerFixture(){
  const f=await jobFixture();
  globalThis.__workerApi={db:f.db,env:{PANTRACK_CART_PREVIEW:'enabled',PANTRACK_CART_WORKER_TRANSPORT:'enabled'}};
  await build({entryPoints:['src/app/api/internal/po-cart-worker/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-worker-api-tests.mjs',
    plugins:[{name:'worker-http',setup(b){
      b.onResolve({filter:/^(cloudflare:workers|@\/db\/raw|@\/lib\/a8-review-source)$/},a=>({path:a.path,namespace:'worker-http'}));
      b.onLoad({filter:/.*/,namespace:'worker-http'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__workerApi.env;':
        a.path==='@/db/raw'?'export const database=()=>globalThis.__workerApi.db;':'export const a8ReviewPolicy=()=>({syncEnabled:false,maxLagMs:600000});',loader:'js'}));
    }}]});
  const api=await import('../../.sites-runtime/po-cart-worker-api-tests.mjs');
  const issuedCredentials=[];
  function credential({companyId='a',supplierId='cart-demo-supplier',accountId='DEMO-CART',workerId=randomUUID(),expiresAt=new Date(Date.now()+3600000).toISOString(),version=1,consumerKind='fake'}={}){
    const secret=randomBytes(32).toString('base64url'),credentialId=randomUUID();
    issuedCredentials.push({secret,workerId,credentialId});
    f.sql.prepare("INSERT OR IGNORE INTO po_cart_worker_identities(id,company_id,supplier_id,account_id,version,status,created_at,consumer_kind) VALUES(?,?,?,?,1,'active',?,?)").run(workerId,companyId,supplierId,accountId,new Date().toISOString(),consumerKind);
    f.sql.prepare("INSERT INTO po_cart_worker_credentials VALUES(?,?,?,?,'active',?,?,NULL)")
      .run(credentialId,workerId,createHash('sha256').update(secret).digest('hex'),version,expiresAt,new Date(Date.now()-7200000).toISOString());
    return {secret,workerId,credentialId};
  }
  function revoke(c){f.sql.prepare("UPDATE po_cart_worker_credentials SET status='revoked',revoked_at=? WHERE id=? AND status='active'").run(new Date().toISOString(),c.credentialId);}
  const request=(c,body,jobId,headers={},host=workerOrigin)=>{
    const req=new Request(host+'/api/internal/po-cart-worker'+(jobId?'?jobId='+jobId:''),{
      method:body?'POST':'GET',headers:{...(c?{authorization:'Bearer '+c.secret}:{}),...(body?{'content-type':'application/json'}:{}),...headers},
      ...(body?{body:JSON.stringify(body)}:{})});return body?api.POST(req):api.GET(req);
  };
  return {...f,api,credential,revoke,request,issuedCredentials};
}
