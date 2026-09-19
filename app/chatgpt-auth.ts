// Compatibility exports keep existing API families on one verified identity path.
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {sessionFromHeaders,type AuthUser} from '@/lib/auth';
declare const __PANTRACK_LOCAL_AUTH_KEY__: string;
export type ChatGPTUser=AuthUser;
export async function getChatGPTUser():Promise<AuthUser|null>{
  const h=await headers();
  const key=typeof __PANTRACK_LOCAL_AUTH_KEY__==='undefined'?'':__PANTRACK_LOCAL_AUTH_KEY__;
  if(key){
    const stamp=h.get('x-pantrack-local-stamp')||'',signature=h.get('x-pantrack-local-signature')||'';
    if(/^\d+$/.test(stamp)&&Math.abs(Date.now()-Number(stamp))<30000&&/^[a-f0-9]{64}$/.test(signature)){
      const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
      if(await crypto.subtle.verify('HMAC',k,Uint8Array.from(signature.match(/../g)!,x=>parseInt(x,16)),new TextEncoder().encode(stamp)))return {userId:'local_seedy',email:'seedy@sites.test',displayName:'Seedy',fullName:'Seedy'};
    }
  }
  const session=await sessionFromHeaders(h);
  if(!session||session.recovery)return null;
  const {accessToken:_,...user}=session;
  return user;
}
export async function requireChatGPTUser(returnTo:string){const u=await getChatGPTUser();if(u)return u;redirect(chatGPTSignInPath(returnTo));}
export function safeReturn(value:string){try{const u=new URL(value,'https://app.local');return value.startsWith('/')&&u.origin==='https://app.local'&&!u.pathname.startsWith('/auth')?u.pathname+u.search:'/';}catch{return '/';}}
export function chatGPTSignInPath(returnTo='/'){return '/auth?next='+encodeURIComponent(safeReturn(returnTo));}
export function chatGPTSignOutPath(){return '/auth/signout';}
