import {appOrigin,audit,cookieValue,createSession,csrf,hash,sessionCookie,sessionFromHeaders,supabase,verifyToken} from '@/lib/auth';
import {database} from '@/db/raw';
import {isValidNewPassword,NEW_PASSWORD_MIN_LENGTH,NEW_PASSWORD_REQUIREMENT} from '@/lib/password-policy';
import {z} from 'zod';
const newPassword=z.string().min(NEW_PASSWORD_MIN_LENGTH).max(1024).refine(isValidNewPassword);
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('signin'),email:z.string().email().max(254),password:z.string().min(1).max(1024)}),
  z.object({action:z.literal('signup'),email:z.string().email().max(254),password:newPassword}),
  z.object({action:z.literal('recover'),email:z.string().email().max(254)}),
  z.object({action:z.literal('verify'),token_hash:z.string().min(1).max(2000),type:z.enum(['signup','recovery'])}),
  z.object({action:z.literal('password'),password:newPassword}),
  z.object({action:z.literal('reauthenticate'),password:z.string().min(1).max(1024)}),
  z.object({action:z.literal('signout')}),
]);
function reply(body:unknown,cookie?:string){return Response.json(body,{headers:{'Cache-Control':'private, no-store',...(cookie?{'Set-Cookie':cookie}:{})}});}
export async function POST(req:Request){
  if(!csrf(req))return Response.json({error:'Invalid request origin.'},{status:403});
  try{
    if(new URL(req.url).origin!==appOrigin())return Response.json({error:'Invalid application origin.'},{status:403});
    const b=input.parse(await req.json()),session=await sessionFromHeaders(req.headers),db=database();
    if(b.action==='signout'){
      const raw=cookieValue(req.headers,appOrigin().startsWith('https:')?'__Host-pantrack':'pantrack_local');
      // Revocation must work even when the provider is offline or the token expired.
      if(/^[a-f0-9]{64}$/.test(raw))await db.prepare('DELETE FROM auth_sessions WHERE hash=?').bind(await hash(raw)).run();
      if(session){
        await db.batch([db.prepare('DELETE FROM auth_sessions WHERE hash=?').bind(session.sessionHash),audit(null,session.userId,'session.revoked')]);
        try{await supabase('/logout?scope=local',{},session.accessToken);}catch{/* Local revocation is authoritative for Pantrack. */}
      }
      return reply({ok:true},sessionCookie('',0));
    }
    if(b.action==='signup'||b.action==='recover'){
      // Identical response for existing and unknown addresses.
      await supabase(b.action==='signup'?'/signup':'/recover',{email:b.email,...('password' in b?{password:b.password}:{})});
      return reply({message:'If eligible, you will receive an email. Follow its link to continue.'});
    }
    if(b.action==='password'){
      if(!session?.recovery)return Response.json({error:'Open a fresh password recovery link.'},{status:403});
      await db.batch([db.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(session.userId),audit(null,session.userId,'password.recovery_attempt')]);
      await supabase('/user',{password:b.password},session.accessToken,'PUT');
      await audit(null,session.userId,'password.recovered').run();
      try{await supabase('/logout?scope=global',{},session.accessToken);}catch{/* All Pantrack sessions are revoked above. */}
      return reply({message:'Password updated. Sign in with your new password.'},sessionCookie('',0));
    }
    if(b.action==='reauthenticate'){
      if(!session||session.recovery)return Response.json({error:'Please sign in.'},{status:401});
      const result=await supabase('/token?grant_type=password',{email:session.email,password:b.password});
      const verified=await verifyToken(z.object({access_token:z.string()}).parse(result).access_token);
      if(verified.userId!==session.userId)throw new Error('Identity changed. Please sign in again.');
      const fresh=await createSession(result,false,session.sessionHash);
      return reply({ok:true},sessionCookie(fresh.token,fresh.seconds));
    }
    const result=b.action==='signin'?await supabase('/token?grant_type=password',{email:b.email,password:b.password}):await supabase('/verify',{token_hash:b.token_hash,type:b.type});
    const recovery=b.action==='verify'&&b.type==='recovery';
    const fresh=await createSession(result,recovery,session?.sessionHash);
    return reply({ok:true,recovery},sessionCookie(fresh.token,fresh.seconds));
  }catch(e){return Response.json({error:e instanceof z.ZodError?'Check your email and password. '+NEW_PASSWORD_REQUIREMENT:e instanceof Error?e.message:'Authentication unavailable.'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
