'use client';

import { useState } from 'react';

type Mode = 'signIn' | 'signUp' | 'recovery';
type Result = { error?: string; confirmationRequired?: boolean; returnTo?: string };

async function send(body: Record<string, string>): Promise<Result> {
  const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json() as Result;
  if (!response.ok) throw new Error(result.error ?? 'Unable to continue.');
  return result;
}

export default function AuthPanel({ returnTo = '/' }: { returnTo?: string }) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'recovery') { await send({ action: 'requestRecovery', email }); setMessage('If this email has an account, we sent a password-reset link.'); }
      else {
        const result = await send({ action: mode, email, password, returnTo });
        if (result.confirmationRequired) setMessage('Check your email to confirm your account before signing in.');
        else location.assign(result.returnTo || returnTo);
      }
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  const title = mode === 'signIn' ? 'Sign in to Pantrack' : mode === 'signUp' ? 'Create your Pantrack account' : 'Reset your password';
  return <main className="signin-page"><section className="signin-card"><div className="brand">pantrack<span className="brand-period">.</span></div><h1>{title}</h1><p>{mode === 'signIn' ? 'Use the email address associated with your business workspace.' : mode === 'signUp' ? 'Use a work email address. You will confirm it before signing in.' : 'Enter your email and we will send a recovery link.'}</p><form className="product-form" onSubmit={submit}><label>Email<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /></label>{mode !== 'recovery' && <label>Password<input type="password" autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} required minLength={12} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>}{error && <p role="alert" className="error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}<button className="signin-button" disabled={busy}>{busy ? 'Please wait…' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send recovery link'}</button></form><div className="auth-links">{mode !== 'signIn' && <button type="button" onClick={() => { setMode('signIn'); setError(''); setMessage(''); }}>Sign in</button>}{mode !== 'signUp' && <button type="button" onClick={() => { setMode('signUp'); setError(''); setMessage(''); }}>Create an account</button>}{mode !== 'recovery' && <button type="button" onClick={() => { setMode('recovery'); setError(''); setMessage(''); }}>Forgot password?</button>}</div></section></main>;
}
