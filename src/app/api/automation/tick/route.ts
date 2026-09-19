import {database} from '@/db/raw';
import {digest} from '@/lib/vendor-adapter';
import {runCheck} from '@/lib/purchasing-engine';
export async function POST(req:Request){
 try{const id=new URL(req.url).searchParams.get('companyId'),auth=req.headers.get('authorization');if(!id||!auth?.startsWith('Bearer ')||auth.length>200)return Response.json({error:'Unauthorized'},{status:401});
 const row=await database().prepare('SELECT scheduler_hash FROM automation_settings WHERE company_id=?').bind(id).first<{scheduler_hash:string|null}>();
 if(!row?.scheduler_hash||await digest(auth.slice(7))!==row.scheduler_hash)return Response.json({error:'Unauthorized'},{status:401});
 return Response.json(await runCheck(id),{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Check failed; review the automation activity log.'},{status:503});}
}
