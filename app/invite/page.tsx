'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
export default function Invite(){
  const [message,setMessage]=useState('Sign in with the email address that received this invitation, then accept it.'),[busy,setBusy]=useState(false);
  async function accept(){setBusy(true);try{const token=new URLSearchParams(location.hash.slice(1)).get('token');const r=await fetch('/api/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'accept',token})}),d=await r.json() as {error?:string;companyId:string};if(!r.ok)throw new Error(d.error);history.replaceState(null,'','/invite');location.assign('/?company='+encodeURIComponent(d.companyId));}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <main className="signin-page"><section className="signin-card"><h1>Join a company</h1><p role="status">{message}</p><p><a href="/auth" target="_blank" rel="noreferrer">Sign in or create an account in a new tab</a></p><Button disabled={busy} onClick={()=>void accept()}>{busy?'Joining…':'Accept invitation'}</Button><p>Invitations expire after seven days and can be used once.</p></section></main>;
}
