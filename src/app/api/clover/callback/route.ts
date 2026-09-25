import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {digest,encrypt} from '@/lib/vendor-adapter';
import {cloverConfig,cloverOrigin,cloverJson,tokenExchange} from '@/lib/clover';
import {audit} from '@/lib/auth';
import {z} from 'zod';
export async function GET(req:Request){
 let companyId='';
 try{const url=new URL(req.url),state=url.searchParams.get('state')||'',cookie=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('clover_oauth='))?.slice(13);if(!state||state.length>200||cookie!==state)throw new Error('Invalid authorization state.');
 const u=await getChatGPTUser();if(!u)throw new Error('Sign in and reconnect.');const db=database(),row=await db.prepare('DELETE FROM clover_oauth_states WHERE state_hash=? AND user_id=? AND expires>? RETURNING *').bind(await digest(state),u.userId,Date.now()).first<{company_id:string;environment:string}>();if(!row)throw new Error('Authorization expired.');companyId=row.company_id;
 const c=cloverConfig();if(!c.ready||c.environment!==row.environment||(await companyAccess(u.userId,companyId))?.role!=='owner')throw new Error('Access changed.');
 const code=z.string().min(1).max(4000).parse(url.searchParams.get('code')),merchant=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(url.searchParams.get('merchant_id'));
 const t=await tokenExchange({code});const verified=z.object({id:z.string()}).parse(await cloverJson(c.api+'/v3/merchants/'+encodeURIComponent(merchant),{headers:{Authorization:'Bearer '+t.access_token}}));if(verified.id!==merchant)throw new Error('Merchant verification failed.');
 const now=Date.now();
 await db.batch([
 db.prepare('INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0) ON CONFLICT(company_id) DO UPDATE SET merchant_id=excluded.merchant_id,environment=excluded.environment,secret=excluded.secret,connected=excluded.connected,last_checked=excluded.last_checked WHERE clover_connections.lease_until<?').bind(companyId,merchant,c.environment,await encrypt(JSON.stringify(t),'clover:'+companyId),new Date(now).toISOString(),new Date(now).toISOString(),now),
 db.prepare(`INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until)
 SELECT ?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM clover_connections WHERE company_id=? AND environment=? AND merchant_id=? AND lease_until<?)
 ON CONFLICT(company_id) DO UPDATE SET environment=excluded.environment,merchant_id=excluded.merchant_id,
 started_at=CASE WHEN environment=excluded.environment AND merchant_id=excluded.merchant_id THEN started_at ELSE excluded.started_at END,
 checkpoint=CASE WHEN environment=excluded.environment AND merchant_id=excluded.merchant_id THEN checkpoint ELSE excluded.checkpoint END,
 last_error=NULL WHERE lease_until<?`).bind(companyId,c.environment,merchant,now,now,companyId,c.environment,merchant,now,now),
 ]);
 const saved=await db.prepare('SELECT 1 FROM clover_connections c JOIN clover_sync_state s ON s.company_id=c.company_id WHERE c.company_id=? AND c.environment=? AND c.merchant_id=? AND c.lease_until<? AND s.environment=c.environment AND s.merchant_id=c.merchant_id').bind(companyId,c.environment,merchant,now).first();if(!saved)throw new Error('Connection is busy.');
 await audit(companyId,u.userId,'clover.connected').run();
 return back(companyId,'connected');
 }catch{return back(companyId,'failed');}
}
function back(companyId:string,result:string){const url=new URL(cloverOrigin());url.search=new URLSearchParams({company:companyId,clover:result}).toString();return new Response(null,{status:303,headers:{Location:url.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'clover_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/clover; Max-Age=0'}});}
