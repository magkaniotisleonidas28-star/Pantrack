import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {audit,csrf} from '@/lib/auth';
import {z} from 'zod';
export type Role='owner'|'manager'|'employee';
export type Permission='read'|'operate'|'integrations'|'members'|'finance'|'pause'|'recordWaste';
export function permitted(role:string,permission:Permission){
  return role==='owner'||role==='manager'&&['read','operate','pause','recordWaste'].includes(permission)||role==='employee'&&['read','recordWaste'].includes(permission);
}
type Family='companies'|'workspace'|'inventory'|'sales'|'register'|'clover'|'payments'|'automation'|'members'|'waste'|'waste-shortcuts'|'purchasing';
export function routePermission(family:Family,method:string,action?:string):Permission{
  if(family==='purchasing')return 'operate';
  if(family==='waste')return 'recordWaste';
  if(family==='waste-shortcuts')return 'operate';
  if(family==='members'||family==='companies')return 'members';
  if(family==='payments')return 'finance';
  if(family==='clover'||family==='register'&&method!=='GET')return 'integrations';
  if(family==='automation')return method==='GET'||['run','approve','reconcile','dismiss','received'].includes(action||'')?'operate':action==='pause'?'pause':'integrations';
  return method==='GET'?'read':'operate';
}
export function withCompanyRoute(family:Family,handler:(req:Request)=>Promise<Response>){
  return async(req:Request):Promise<Response>=>{
    try{
      const user=await getChatGPTUser();
      if(!user)return Response.json({error:'Your session has expired. Please sign in.'},{status:401});
      const mutation=req.method!=='GET';
      if(mutation&&!csrf(req))return Response.json({error:'Invalid request origin or content type.'},{status:403});
      const body=mutation?z.object({companyId:z.string().optional(),id:z.string().optional(),action:z.string().optional()}).passthrough().parse(await req.clone().json()):null;
      const companyId=mutation?(family==='companies'?body?.id:body?.companyId):new URL(req.url).searchParams.get('companyId');
      if(!(family==='companies'&&(!mutation||body?.action==='create'))){
        const member=await companyAccess(user.userId,companyId);
        if(!member||!permitted(member.role,routePermission(family,req.method,body?.action)))return Response.json({error:'You do not have permission for this company action.'},{status:403});
      }
      const logged=mutation&&['companies','inventory','register','clover','payments','automation','waste','waste-shortcuts'].includes(family);
      const target=(family==='waste'||family==='waste-shortcuts')&&typeof body?.operationId==='string'
        ?body.operationId.slice(0,80):typeof body?.action==='string'?body.action.slice(0,80):'';
      if(logged)await audit(typeof companyId==='string'?companyId:null,user.userId,family+'.attempt',target).run();
      const response=await handler(req);
      if(logged)await audit(typeof companyId==='string'?companyId:null,user.userId,family+(response.ok?'.succeeded':'.failed'),target).run();
      response.headers.set('Cache-Control','private, no-store');
      return response;
    }catch{if(family==='waste'||family==='waste-shortcuts')return Response.json({error:'The save outcome is uncertain. Retry the same entry.',uncertain:true},{status:503});return Response.json({error:'Request could not be completed. Please retry.'},{status:400});}
  };
}
