import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {digest} from '@/lib/vendor-adapter';
import {a8ReviewPolicy} from '@/lib/a8-review-source';
import {D1PoDraftScheduler} from '@/lib/d1-po-draft-schedules';

// Local stand-in for the Cron trigger: one company's weekly draft check, authenticated with that
// company's scheduler token (stored only as a hash). Preview-only and loopback-only; Cron is not wired.
function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
export async function POST(req:Request){
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try{
    const companyId=new URL(req.url).searchParams.get('companyId'),auth=req.headers.get('authorization');
    if(!companyId||companyId.length>200||!auth?.startsWith('Bearer ')||auth.length>200)return Response.json({error:'Unauthorized'},{status:401});
    const db=database(),row=await db.prepare('SELECT scheduler_hash FROM automation_settings WHERE company_id=?').bind(companyId).first<{scheduler_hash:string|null}>();
    if(!row?.scheduler_hash||await digest(auth.slice(7))!==row.scheduler_hash)return Response.json({error:'Unauthorized'},{status:401});
    return Response.json(await new D1PoDraftScheduler(db,{salesPolicy:a8ReviewPolicy()}).tick(companyId),{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'The weekly draft check failed; nothing was drafted twice. Try again.'},{status:503});}
}
