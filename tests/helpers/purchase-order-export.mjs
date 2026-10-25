import {build} from 'esbuild';
import {fixture} from './supplier-simulation.mjs';
await build({stdin:{contents:[
  'd1-purchase-order-exports','purchase-order-export-contract','d1-purchase-order-drafts','d1-purchasing-suppliers',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/purchase-order-export-tests.mjs'});
export const core=await import('../../.sites-runtime/purchase-order-export-tests.mjs');
export async function exportFixture(){
  const f=await fixture(),state={user:'manager',env:{PANTRACK_PO_DRAFT_PREVIEW:'enabled'},beforeExportRead:null,exportReads:0};
  function wrapped(statement,isExport){
    return new Proxy(statement,{get(target,key){
      if(key==='bind')return(...values)=>wrapped(target.bind(...values),isExport);
      if(key==='first'&&isExport)return async(...args)=>{
        state.exportReads++;
        const hook=state.beforeExportRead;state.beforeExportRead=null;if(hook)await hook();
        return target.first(...args);
      };
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
  }
  const db={prepare:sql=>wrapped(f.db.prepare(sql),sql.includes('FROM memberships m')),
    batch:statements=>f.db.batch(statements)};
  state.db=db;
  const options={identity:async()=>state.user,clock:f.options.clock,salesPolicy:f.options.salesPolicy};
  const drafts=new core.D1PurchaseOrderDrafts(f.db,options),exports=new core.D1PurchaseOrderExports(db,options);
  const supplier={id:'fake-supplier',name:'Fictional Café Supply',email:'orders@example.invalid',accountId:'fake-account',locationId:'fake-location',deliveryAddress:'123 Fictional Street'};
  const nonStock={kind:'non_stock',sku:'BAGS',description:'Delivery bags',unitLabel:'case',packs:'2',estimatedUnitMinor:null};
  const create=(extra={})=>Object.fromEntries(Object.entries({action:'create',companyId:'a',operationId:crypto.randomUUID(),source:'manual',supplier,
    capMinor:'10000',notes:'Fictional draft only',lines:[nonStock],...extra}).filter(([,value])=>value!==undefined));
  const select=view=>({companyId:view.snapshot.companyId,orderId:view.snapshot.id,revision:view.revision});
  const edit=(view,extra={})=>({...create(),action:'edit',orderId:view.snapshot.id,expectedRevision:view.revision,reason:'Correct fictional draft',notes:'Edited notes',...extra});
  const allTables=()=>JSON.stringify(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({name})=>[name,f.sql.prepare(`SELECT * FROM "${name}"`).all()]));
  return {...f,state,db,drafts,exports,supplier,nonStock,create,select,edit,allTables};
}
