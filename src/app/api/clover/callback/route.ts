import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {digest,encrypt} from '@/lib/vendor-adapter';
import {CloverHttpError,cloverConfig,cloverOrigin,cloverJson,tokenExchange} from '@/lib/clover';
import {z} from 'zod';
type FailureReason='oauth_state'|'session'|'state_lookup'|'state_expired'|'access'|'provider_denied'|'callback'|'token_rejected'|'token_unavailable'|'token_response'|'merchant_rejected'|'merchant_unavailable'|'merchant_response'|'merchant_mismatch'|'save';
export async function GET(req:Request){
 let companyId='',reason:FailureReason='oauth_state';
 try{
 const url=new URL(req.url),state=url.searchParams.get('state')||'',cookie=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('clover_oauth='))?.slice(13);if(!state||state.length>200||cookie!==state)throw new Error('Invalid authorization state.');
 reason='session';const u=await getChatGPTUser();if(!u)throw new Error('Sign in and reconnect.');
 reason='state_lookup';const db=database(),row=await db.prepare('DELETE FROM clover_oauth_states WHERE state_hash=? AND user_id=? AND expires>? RETURNING *').bind(await digest(state),u.userId,Date.now()).first<{company_id:string;environment:string}>();reason='state_expired';if(!row)throw new Error('Authorization expired.');companyId=row.company_id;
 reason='access';const c=cloverConfig();if(!c.ready||c.environment!==row.environment||(await companyAccess(u.userId,companyId))?.role!=='owner')throw new Error('Access changed.');
 reason='provider_denied';if(url.searchParams.has('error'))throw new Error('Clover authorization was canceled.');
 reason='callback';const code=z.string().min(1).max(4000).parse(url.searchParams.get('code')),merchant=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(url.searchParams.get('merchant_id'));
 reason='token_unavailable';let t:Awaited<ReturnType<typeof tokenExchange>>;
 try{t=await tokenExchange({code});}catch(e){reason=e instanceof CloverHttpError?(e.status>=300&&e.status<500&&e.status!==429?'token_rejected':'token_unavailable'):e instanceof z.ZodError||e instanceof SyntaxError?'token_response':'token_unavailable';throw e;}
 reason='merchant_unavailable';let verified:{id:string};
 try{verified=z.object({id:z.string()}).parse(await cloverJson(c.api+'/v3/merchants/'+encodeURIComponent(merchant),{headers:{Authorization:'Bearer '+t.access_token}}));}catch(e){reason=e instanceof CloverHttpError?(e.status>=300&&e.status<500&&e.status!==429?'merchant_rejected':'merchant_unavailable'):e instanceof z.ZodError||e instanceof SyntaxError?'merchant_response':'merchant_unavailable';throw e;}
 reason='merchant_mismatch';if(verified.id!==merchant)throw new Error('Merchant verification failed.');
 reason='save';
 const now=Date.now();
 await db.batch([
 db.prepare('INSERT INTO clover_connections(company_id,merchant_id,environment,secret,connected,last_checked,lease_until) VALUES (?,?,?,?,?,?,0) ON CONFLICT(company_id) DO UPDATE SET merchant_id=excluded.merchant_id,environment=excluded.environment,secret=excluded.secret,connected=excluded.connected,last_checked=excluded.last_checked WHERE clover_connections.lease_until<?').bind(companyId,merchant,c.environment,await encrypt(JSON.stringify(t),'clover:'+companyId),new Date(now).toISOString(),new Date(now).toISOString(),now),
 db.prepare(`INSERT INTO clover_sync_state(company_id,environment,merchant_id,started_at,checkpoint,lease_until)
 SELECT ?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM clover_connections WHERE company_id=? AND environment=? AND merchant_id=? AND lease_until<?)
 ON CONFLICT(company_id) DO UPDATE SET environment=excluded.environment,merchant_id=excluded.merchant_id,
 started_at=CASE WHEN environment=excluded.environment AND merchant_id=excluded.merchant_id THEN started_at ELSE excluded.started_at END,
 checkpoint=CASE WHEN environment=excluded.environment AND merchant_id=excluded.merchant_id THEN checkpoint ELSE excluded.checkpoint END,
 last_error=NULL WHERE lease_until<?`).bind(companyId,c.environment,merchant,now,now,companyId,c.environment,merchant,now,now),
 db.prepare('INSERT INTO security_audit(id,company_id,actor,action,target,created) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clover_connections WHERE company_id=? AND environment=? AND merchant_id=? AND last_checked=? AND lease_until<?)').bind(crypto.randomUUID(),companyId,u.userId,'clover.connected','',now,companyId,c.environment,merchant,new Date(now).toISOString(),now),
 ]);
 const saved=await db.prepare('SELECT 1 FROM clover_connections c JOIN clover_sync_state s ON s.company_id=c.company_id WHERE c.company_id=? AND c.environment=? AND c.merchant_id=? AND c.lease_until<? AND s.environment=c.environment AND s.merchant_id=c.merchant_id').bind(companyId,c.environment,merchant,now).first();if(!saved)throw new Error('Connection is busy.');
 return back(companyId,'connected');
 }catch(e){
  const errorKind=e instanceof CloverHttpError?'clover_http':e instanceof z.ZodError?'schema':e instanceof SyntaxError?'json':e instanceof DOMException&&e.name==='TimeoutError'?'timeout':e instanceof TypeError?'transport':'other';
  console.error('Clover OAuth callback failed',{reason,errorKind,...e instanceof CloverHttpError?{providerStatus:e.status}:{}});
  return back(companyId,'failed',reason);
 }
}
function back(companyId:string,result:'connected'|'failed',reason?:FailureReason){const url=new URL(cloverOrigin());url.search=new URLSearchParams({...companyId?{company:companyId}:{},clover:result,...reason?{reason}:{}}).toString();return new Response(null,{status:303,headers:{Location:url.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'clover_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/clover; Max-Age=0'}});}
