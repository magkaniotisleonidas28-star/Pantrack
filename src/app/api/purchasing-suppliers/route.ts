import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {withCompanyRoute} from '@/lib/authorization';
import {D1PurchasingSuppliers} from '@/lib/d1-purchasing-suppliers';
import {SupplierRegistryError} from '@/lib/purchasing-supplier-contract';

function enabled(){return (env as unknown as {PANTRACK_PO_DRAFT_PREVIEW?:string}).PANTRACK_PO_DRAFT_PREVIEW==='enabled';}
function service(){return new D1PurchasingSuppliers(database(),{identity:async()=>(await getChatGPTUser())?.userId??null});}
function failure(error:unknown){
  if(error instanceof SupplierRegistryError)return Response.json({error:error.message,code:error.code},{status:
    error.code==='forbidden'?403:error.code==='missing'?404:error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
  return Response.json({error:'The registry save outcome may be uncertain. Retry the same request.',uncertain:true},{status:503});
}
async function get(req:Request){
  if(!enabled())return Response.json({error:'Purchasing supplier preview is off.'},{status:404});
  const p=new URL(req.url).searchParams,company=p.get('companyId')??'',id=p.get('supplierId')??'',offset=Number(p.get('offset')??'0');
  try{const store=service();
    if(p.get('view')==='stocks')return Response.json(await store.stocks(company,offset));
    if(p.get('view')==='units')return Response.json(await store.units(company,p.get('productId')??''));
    if(p.get('view')==='projection')return Response.json(await store.projection(company,p.get('mappingId')??''));
    if(p.get('view')==='history')return Response.json(await store.history(company,p.get('mappingId')??id,p.has('mappingId')?'mapping':'profile',offset));
    if(p.get('view')==='mappings')return Response.json(await store.mappings(company,id,offset));
    if(p.has('mappingId'))return Response.json({mapping:await store.mapping(company,p.get('mappingId')!)});
    if(id)return Response.json({supplier:await store.profile(company,id,p.has('version')?Number(p.get('version')):undefined)});
    return Response.json(await store.list(company,offset));
  }catch(error){return failure(error);}
}
async function post(req:Request){
  if(!enabled())return Response.json({error:'Purchasing supplier preview is off.'},{status:404});
  try{const body:unknown=await req.json();if(!body||typeof body!=='object'||!('action' in body))return Response.json({error:'Choose a registry action.'},{status:400});
    const store=service();
    switch(body.action){
      case 'save_profile':return Response.json({supplier:await store.saveProfile(body)});
      case 'archive_profile':return Response.json({supplier:await store.archiveProfile(body)});
      case 'save_mapping':return Response.json({mapping:await store.saveMapping(body)});
      case 'archive_mapping':return Response.json({mapping:await store.archiveMapping(body)});
      default:return Response.json({error:'Only supplier and mapping review actions are available.'},{status:400});
    }
  }catch(error){return failure(error);}
}
export const GET=withCompanyRoute('purchasing',get);
export const POST=withCompanyRoute('purchasing',post);
