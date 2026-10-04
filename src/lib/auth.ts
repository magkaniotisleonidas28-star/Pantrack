import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {z} from 'zod';
import {type AuthenticationFence} from '@/lib/auth-session-fence';

export type AuthUser = {userId:string; email:string; displayName:string; fullName:string|null; sessionHash?:string; reauthenticatedAt?:number; recovery?:boolean};
const encoder = new TextEncoder();
const settings = () => env as unknown as Record<string,string|undefined>;
export function appOrigin() {
  const value=settings().APP_ORIGIN;
  if(!value)throw new Error('Authentication is not configured.');
  const url=new URL(value);
  if(url.origin!==value || (url.protocol!=='https:' && !['http://localhost:5173','http://127.0.0.1:5173',...(settings().PANTRACK_USABILITY_PREVIEW==='enabled'?['http://127.0.0.1:5177']:[])].includes(value)))throw new Error('Invalid application origin.');
  return value;
}
export function csrf(req:Request) {
  // Origin is required even without Fetch Metadata. JSON prevents HTML forms.
  return req.headers.get('origin')===new URL(req.url).origin && req.headers.get('sec-fetch-site')!=='cross-site' && req.headers.get('content-type')?.split(';')[0].trim()==='application/json';
}
export function cookieValue(headers:Headers,name:string) {
  const values=(headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  return values.length===1?values[0].slice(name.length+1):'';
}
export function sessionCookie(token:string, seconds:number, origin=appOrigin()) {
  return `${origin.startsWith('https:')?'__Host-pantrack':'pantrack_local'}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0,Math.floor(seconds))}${origin.startsWith('https:')?'; Secure':''}`;
}
export function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
async function encryptionKey(){
  const secret=settings().AUTH_ENCRYPTION_KEY||'';
  if(!/^[a-fA-F0-9]{64}$/.test(secret))throw new Error('Authentication encryption is not configured.');
  return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!,x=>parseInt(x,16)),'AES-GCM',false,['encrypt','decrypt']);
}
async function seal(value:string, scope:string){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(scope)},await encryptionKey(),encoder.encode(value));return btoa(String.fromCharCode(...iv,...new Uint8Array(data)));}
async function unseal(value:string,scope:string){const data=Uint8Array.from(atob(value),x=>x.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12),additionalData:encoder.encode(scope)},await encryptionKey(),data.slice(12)));}
export class AuthProviderError extends Error {
  constructor(message:string,public readonly uncertain:boolean){super(message);}
}
export async function supabase(path:string,body?:unknown,token?:string,method=body===undefined?'GET':'POST') {
  const e=settings(),url=e.SUPABASE_URL,key=e.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key||!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw new Error('Authentication is not configured.');
  const response=await fetch(url+'/auth/v1'+path,{method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok)throw new AuthProviderError(response.status===429?'Too many attempts. Please wait before retrying.':'Authentication failed. Check your credentials or request a new link.',response.status>=500||response.status<400);
  return response.status===204?{}:await response.json();
}
const verifiedUser=z.object({id:z.string().uuid(),email:z.string().email(),email_confirmed_at:z.string().min(1),is_anonymous:z.boolean().optional(),user_metadata:z.object({full_name:z.string().optional()}).passthrough().optional()});
export async function verifyToken(token:string):Promise<AuthUser>{
  const u=verifiedUser.parse(await supabase('/user',undefined,token));
  if(u.is_anonymous)throw new Error('Confirm your email before signing in.');
  return {userId:u.id,email:u.email.toLowerCase(),displayName:u.user_metadata?.full_name||u.email,fullName:u.user_metadata?.full_name||null};
}
export function audit(companyId:string|null,actor:string,action:string,target=''){
  return database().prepare('INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),companyId,actor,action,target,Date.now());
}
export async function createSession(result:unknown,fence:AuthenticationFence,recovery=false,oldHash?:string,expectedUserId?:string){
  const t=z.object({access_token:z.string().min(1).max(20000),expires_in:z.number().positive().max(604800)}).parse(result);
  const user=await verifyToken(t.access_token),token=randomToken(),digest=await hash(token);
  if(expectedUserId && (user.userId!==expectedUserId||!oldHash))throw new Error('Identity changed. Please sign in again.');
  // No long-lived refresh tokens are retained. Reauthentication is explicit.
  const seconds=Math.min(t.expires_in,3600),now=Date.now(),db=database();
  const predecessor='(? IS NULL OR EXISTS(SELECT 1 FROM auth_sessions s JOIN auth_users p ON p.id=s.user_id WHERE s.hash=? AND s.expires>? AND s.epoch=p.session_epoch AND p.recovery_id IS NULL))';
  const results=await db.batch([
    db.prepare(`INSERT INTO auth_users(id,email,verified_at) SELECT ?,?,?
      WHERE NOT EXISTS(SELECT 1 FROM auth_users WHERE id=? AND (session_epoch>? OR recovery_id IS NOT NULL)) AND ${predecessor}
      ON CONFLICT(id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at`)
      .bind(user.userId,user.email,now,user.userId,fence.epoch,oldHash||null,oldHash||null,now),
    db.prepare(`INSERT INTO auth_sessions(hash,user_id,token,expires,reauthenticated_at,recovery,epoch)
      SELECT ?,id,?,?,?,?,session_epoch FROM auth_users WHERE id=? AND session_epoch<=? AND recovery_id IS NULL AND ${predecessor}`)
      .bind(digest,await seal(t.access_token,digest),now+seconds*1000,recovery?0:now,recovery?1:0,user.userId,fence.epoch,oldHash||null,oldHash||null,now),
    ...(oldHash?[db.prepare('DELETE FROM auth_sessions WHERE hash=? AND EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(oldHash,digest)]:[]),
    db.prepare('INSERT INTO security_audit(id,company_id,actor,action,target,created) SELECT ?,NULL,?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)')
      .bind(crypto.randomUUID(),user.userId,recovery?'recovery.started':'session.created','',now,digest),
    db.prepare('SELECT hash FROM auth_sessions WHERE hash=?').bind(digest),
  ]);
  if(results.at(-1)?.results?.length!==1)throw new Error('Authentication changed. Please sign in again or request a fresh recovery link.');
  return {token,seconds,user};
}
export async function sessionFromHeaders(headers:Headers):Promise<(AuthUser & {accessToken:string})|null>{
  try {
    const raw=cookieValue(headers,appOrigin().startsWith('https:')?'__Host-pantrack':'pantrack_local');
    if(!/^[a-f0-9]{64}$/.test(raw))return null;
    const digest=await hash(raw),db=database(),row=await db.prepare('SELECT s.* FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND s.epoch=u.session_epoch AND u.recovery_id IS NULL').bind(digest,Date.now()).first<{user_id:string;token:string;expires:number;reauthenticated_at:number;recovery:number;epoch:number}>();
    if(!row)return null;
    const accessToken=await unseal(row.token,digest),user=await verifyToken(accessToken);
    if(user.userId!==row.user_id)return null;
    // Recovery may have happened while the provider GET was in flight.
    if(!await db.prepare('SELECT s.hash FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.hash=? AND s.user_id=? AND s.epoch=? AND s.expires>? AND s.epoch=u.session_epoch AND u.recovery_id IS NULL').bind(digest,user.userId,row.epoch,Date.now()).first())return null;
    return {...user,sessionHash:digest,reauthenticatedAt:row.reauthenticated_at,recovery:!!row.recovery,accessToken};
  }catch{return null;}
}
export function recentlyVerified(user:AuthUser){return !user.recovery && !!user.reauthenticatedAt && user.reauthenticatedAt>Date.now()-5*60*1000;}
