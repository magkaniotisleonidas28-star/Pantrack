import {build} from 'esbuild';
import {exportFixture} from './purchase-order-export.mjs';
await build({stdin:{contents:['d1-purchase-order-history-exports','purchase-order-history-export-contract',
  'purchase-order-history-documents','purchase-order-history-download','purchase-order-download','d1-purchasing-suppliers',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},
  bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/purchase-order-history-export-tests.mjs'});
export const core=await import('../../.sites-runtime/purchase-order-history-export-tests.mjs');
export async function historyFixture(){
  const f=await exportFixture();Object.assign(f.state,{historyReads:0,beforeHistoryRead:null,lastHistoryRows:null});
  function wrapped(statement,isHistory){return new Proxy(statement,{get(target,key){
    if(key==='bind')return(...values)=>wrapped(target.bind(...values),isHistory);
    if(key==='all'&&isHistory)return async()=>{
      f.state.historyReads++;const hook=f.state.beforeHistoryRead;f.state.beforeHistoryRead=null;if(hook)await hook();
      const result=await target.all();f.state.lastHistoryRows=result.results;return result;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});}
  const db={prepare:sql=>wrapped(f.db.prepare(sql),sql.includes('WITH history_export_allowed AS')),batch:statements=>f.db.batch(statements)};
  f.state.db=db;
  const history=new core.D1PurchaseOrderHistoryExports(db,{identity:async()=>f.state.user});
  const cancel=view=>f.drafts.cancel({action:'cancel',companyId:view.snapshot.companyId,orderId:view.snapshot.id,
    expectedRevision:view.revision,operationId:crypto.randomUUID(),reason:'Fictional history cancellation'});
  const review=view=>f.drafts.review({action:'review',companyId:view.snapshot.companyId,orderId:view.snapshot.id,
    expectedRevision:view.revision,operationId:crypto.randomUUID(),acknowledgeWarnings:true});
  return {...f,db,history,cancel,review};
}
