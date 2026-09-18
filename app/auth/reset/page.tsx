'use client';

import { useEffect, useState } from 'react';

export default function ResetPassword() {
  const [ready, setReady] = useState(false); const [password, setPassword] = useState(''); const [message, setMessage] = useState('Checking your recovery link…');
  useEffect(() => {
    const values = new URLSearchParams(location.hash.slice(1)); const accessToken = values.get('access_token'); const refreshToken = values.get('refresh_token');
    if (!accessToken || !refreshToken) { setMessage('This recovery link is incomplete or expired. Request a new one.'); return; }
    fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'establishSession', accessToken, refreshToken, returnTo: '/auth/reset' }) })
      .then(async response => { if (!response.ok) throw new Error((await response.json() as { error?: string }).error); history.replaceState({}, '', '/auth/reset'); setReady(true); setMessage('Choose a new password.'); })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Unable to verify this recovery link.'));
  }, []);
  async function submit(event: React.FormEvent) { event.preventDefault(); setMessage('Saving…'); const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updatePassword', password }) }); const result = await response.json() as { error?: string }; if (!response.ok) { setMessage(result.error ?? 'Unable to change password.'); return; } location.replace('/'); }
  return <main className="signin-page"><section className="signin-card"><div className="brand">pantrack<span className="brand-period">.</span></div><h1>Reset your password</h1><p role="status">{message}</p>{ready && <form className="product-form" onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /></label><button className="signin-button">Save new password</button></form>}</section></main>;
}
