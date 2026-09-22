'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {isValidNewPassword,NEW_PASSWORD_MIN_LENGTH,NEW_PASSWORD_REQUIREMENT} from '@/lib/password-policy';
export default function AuthForm({mode='signin'}:{mode?:'signin'|'signout'|'callback'}){
  const [action,setAction]=useState('signin'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[recovery,setRecovery]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMessage('');
    try{
      const query=new URLSearchParams(location.search);
      const chosen=mode==='signout'?'signout':recovery?'password':mode==='callback'?'verify':action;
      if((chosen==='signup'||chosen==='password')&&!isValidNewPassword(password))throw new Error(NEW_PASSWORD_REQUIREMENT);
      const body=chosen==='verify'?{action:chosen,token_hash:query.get('token_hash'),type:query.get('type')}:{action:chosen,email,password};
      const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json() as {error?:string;message:string;recovery?:boolean};
      if(!r.ok)throw new Error(d.error||'Please retry.');
      setPassword('');
      if(d.recovery){setRecovery(true);history.replaceState(null,'','/auth/callback');setMessage('Enter your new password.');return;}
      if(chosen==='password'){location.assign('/auth');return;}
      if(['signin','verify','signout'].includes(chosen)){
        const next=query.get('next')||'/',url=new URL(next,location.origin);
        location.assign(url.origin===location.origin&&next.startsWith('/')&&!url.pathname.startsWith('/auth')?url.pathname+url.search:'/');
      }else setMessage(d.message);
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <main className="signin-page"><section className="signin-card"><a className="brand" href="/">pantrack.</a><h1>{mode==='signout'?'Sign out':recovery?'Reset password':mode==='callback'?'Confirm your email link':action==='signup'?'Create an account':action==='recover'?'Recover your account':'Welcome back'}</h1><form onSubmit={submit} className="product-form">
    {mode==='signin'&&<label>Email<Input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>}
    {(recovery||mode==='signin'&&action!=='recover')&&<label>Password<Input type="password" autoComplete={recovery||action==='signup'?'new-password':'current-password'} minLength={recovery||action==='signup'?NEW_PASSWORD_MIN_LENGTH:1} aria-describedby={recovery||action==='signup'?'new-password-requirement':undefined} required value={password} onChange={e=>setPassword(e.target.value)}/>{(recovery||action==='signup')&&<small id="new-password-requirement">{NEW_PASSWORD_REQUIREMENT}</small>}</label>}
    {mode==='callback'&&!recovery&&<p>Continue to confirm this single-use email link.</p>}
    <Button disabled={busy}>{busy?'Working…':mode==='signout'?'Sign out':recovery?'Save new password':mode==='callback'?'Continue':action==='recover'?'Send recovery email':action==='signup'?'Create account':'Sign in'}</Button>
    {message&&<p role="status">{message}</p>}
  </form>{mode==='signin'&&<div className="company-actions">{['signin','signup','recover'].filter(v=>v!==action).map(v=><Button variant="ghost" key={v} onClick={()=>{setAction(v);setMessage('');setPassword('');}}>{v==='signin'?'Sign in':v==='signup'?'Create account':'Forgot password?'}</Button>)}</div>}<a href="/">Back to Pantrack</a></section></main>;
}
