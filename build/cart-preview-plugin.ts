import type {Plugin} from 'vite';
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {CartStore} from '../scripts/cart-preview/store';
import {BrowserFixtureStore} from '../scripts/po-cart-worker/fixture-store';
import {CartBrowser} from '../scripts/cart-preview/browser';
import {startFixture} from '../scripts/cart-preview/fixture';
import {cartStartSchema} from '../src/lib/cart-preview-contract';
import type {PurchaseOrderView} from '../src/lib/purchase-order-contract';
import {z} from 'zod';

const actionSchema=z.object({action:z.enum(['resume','cancel','inspect']),companyId:z.string().min(1).max(200),jobId:z.string().uuid()}).strict();
export function cartPreviewPlugin():Plugin{
  return {name:'pantrack-local-cart-preview',apply:'serve',async configureServer(server){
    const runtime=globalThis as typeof globalThis&{__pantrackCartCleanup?:()=>Promise<void>};
    await runtime.__pantrackCartCleanup?.();
    const origin='http://127.0.0.1:5181',path='.sites-runtime/cart-preview';mkdirSync(path,{recursive:true,mode:0o700});
    const lock=path+'/runner.lock';
    if(existsSync(lock)){const pid=Number(readFileSync(lock,'utf8'));let alive=true;try{process.kill(pid,0);}catch{alive=false;}if(alive)throw Error('Another cart runner owns the local store.');unlinkSync(lock);}
    const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
    const store=new CartStore(path);
    const browserLocal=process.env.PANTRACK_CART_BROWSER_LOCAL==='enabled';
    const browser=new CartBrowser(store),fixture=await startFixture(browserLocal?new BrowserFixtureStore('.sites-runtime/po-cart-workers/local-storefront.json'):store);let closed=false;
    const cleanup=async()=>{if(closed)return;closed=true;await browser.close();fixture.closeAllConnections();await new Promise<void>(ok=>fixture.close(()=>ok()));if(existsSync(lock))unlinkSync(lock);};
    runtime.__pantrackCartCleanup=cleanup;
    const close=server.close.bind(server);server.close=async()=>{await cleanup();await close();};
    process.once('exit',()=>{if(!closed&&existsSync(lock))unlinkSync(lock);});
    server.middlewares.use(async(req,res,next)=>{
      const u=new URL(req.url??'/',origin);if(u.pathname!=='/api/cart-preview')return next();
      if(browserLocal){res.writeHead(404,{'cache-control':'private, no-store'});res.end();return;}
      const send=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'private, no-store'});res.end(JSON.stringify(data));};
      if(closed)return send(503,{error:'Cart preview is restarting. Retry after it is ready.'});
      if(req.headers.host!=='127.0.0.1:5181'||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return send(403,{error:'Local preview only.'});
      if(req.method!=='GET'&&req.method!=='POST')return send(405,{error:'Unsupported method.'});
      if(req.method==='POST'&&(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json')||req.headers['sec-fetch-site']==='cross-site'))return send(403,{error:'Invalid request origin or content type.'});
      try{
        let body:Record<string,unknown>={};if(req.method==='POST'){let raw='';for await(const c of req){raw+=c;if(raw.length>10000)return send(413,{error:'Request too large.'});}body=JSON.parse(raw);}
        const companyId=req.method==='GET'?u.searchParams.get('companyId'):body.companyId;
        if(typeof companyId!=='string'||!companyId)return send(400,{error:'Choose a company.'});
        const rawCookie=req.headers.cookie??'';
        const context=async(orderId:string)=>{
          const response=await fetch(origin+'/api/cart-preview-context',{method:'POST',headers:{cookie:rawCookie,origin,'content-type':'application/json'},body:JSON.stringify({companyId,orderId}),signal:AbortSignal.timeout(15000)});
          const data=await response.json() as {actor:string;order:PurchaseOrderView;error?:string};
          if(!response.ok)throw Object.assign(Error(data.error??'Could not authorize draft.'),{status:response.status});return data;
        };
        if(req.method==='GET'&&!u.searchParams.has('jobId')){
          const orderId=u.searchParams.get('orderId');
          if(orderId){const {actor,order}=await context(orderId),job=[...store.state.jobs].reverse().find(j=>j.companyId===companyId&&j.actor===actor&&j.orderId===orderId&&j.state!=='canceled');
            if(job)store.current(job,order);return send(200,{enabled:true,mode:'offline',job:job?store.view(job):null});}
          // Capability check must still enforce auth/company/role through the application.
          const orders=await fetch(origin+`/api/purchase-orders?companyId=${encodeURIComponent(companyId)}`,{headers:{cookie:rawCookie},signal:AbortSignal.timeout(15000)});
          if(!orders.ok)return send(orders.status,{error:'Cart preview unavailable.'});return send(200,{enabled:true,mode:'offline'});
        }
        if(req.method==='POST'&&body.action==='start'){
          const parsed=cartStartSchema.safeParse(body);if(!parsed.success)return send(400,{error:'Choose a valid draft, revision and demo scenario.'});
          const {actor,order}=await context(parsed.data.orderId);
          const job=store.create(parsed.data,actor,order);
          if(!store.current(job,order))return send(409,{error:job.message});
          const current=async()=>{try{const c=await context(job.orderId);return c.actor===job.actor&&store.current(job,c.order);}catch{store.update(job,'needs_review','Session or authorization changed. Sign in again before resuming.');return false;}};
          void browser.run(job,current);return send(200,{job:store.view(job)});
        }
        const jobId=req.method==='GET'?u.searchParams.get('jobId'):body.jobId;
        if(typeof jobId!=='string')return send(400,{error:'Choose a cart job.'});
        const candidate=store.state.jobs.find(j=>j.id===jobId&&j.companyId===companyId);
        if(!candidate)return send(404,{error:'Cart job not found.'});
        const {actor,order}=await context(candidate.orderId),job=store.get(jobId,actor,companyId);
        const valid=store.current(job,order);
        if(req.method==='POST'){
          const parsed=actionSchema.safeParse(body);if(!parsed.success)return send(400,{error:'Choose resume, cancel or inspect.'});
          if(body.action==='cancel'){
            if(browser.running.has(job.id))throw Error('Wait for preparation to stop before canceling.');
            store.update(job,'canceled','Preparation canceled. Existing cart contents are preserved.');
          }else if(body.action==='inspect')await browser.inspect(job);
          else{
            if(!valid||job.state==='canceled'||job.state==='ready')throw Error('This job cannot resume. Review its status.');
            const current=async()=>{try{const c=await context(job.orderId);return c.actor===actor&&store.current(job,c.order);}catch{store.update(job,'needs_review','Session or authorization changed.');return false;}};
            void browser.run(job,current);
          }
        }
        send(200,{job:store.view(job)});
      }catch(e){send((e as {status?:number}).status??409,{error:(e as Error).message});}
    });
  }};
}
