import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {cartFixture,command,tables,cartTables} from './po-cart-authorizations.mjs';
await build({entryPoints:['src/lib/d1-po-cart-jobs.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/durable-po-cart-job-tests.mjs'});
export const {D1PoCartJobs}=await import('../../.sites-runtime/durable-po-cart-job-tests.mjs');
export const jobTables=[...cartTables,'po_cart_jobs','po_cart_owners','po_cart_attempts','po_cart_results','po_cart_job_events','po_cart_job_operations'];
export const enqueue=a=>({action:'enqueue',companyId:a.companyId,authorizationId:a.id,expectedRevision:a.revision,operationId:randomUUID()});
export const operation=j=>({companyId:j.companyId,jobId:j.id,operationId:randomUUID()});
export const fenced=(j,fence)=>({...operation(j),fence});
export const cancel=j=>({...operation(j),action:'cancel',expectedRevision:j.revision,reason:'Cancel fictional preparation'});
export const conflict=e=>e.code==='conflict';
export const snapshot=f=>tables(f.sql,jobTables);
export async function jobFixture(){
  const f=await cartFixture(),jobs=()=>new D1PoCartJobs(f.db,f.options),worker=(id='one')=>new D1PoCartJobs(f.db,{...f.options,workerId:id});
  async function authorized(extra={}){const po=await f.reviewed(extra);return (await f.service().authorize(command(po))).current.authorization;}
  async function queued(extra={}){const a=await authorized(extra),input=enqueue(a);return {a,input,...await jobs().enqueue(input)};}
  return {...f,jobs,worker,authorized,queued};
}
