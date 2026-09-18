'use client';

import { useEffect, useState } from 'react';

export default function ConfirmAuth() {
  const [message, setMessage] = useState('Confirming your account…');
  useEffect(() => {
    const values = new URLSearchParams(location.hash.slice(1));
    const accessToken = values.get('access_token'); const refreshToken = values.get('refresh_token');
    if (!accessToken || !refreshToken) { setMessage('This confirmation link is incomplete or has expired. Request a new confirmation email.'); return; }
    fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'establishSession', accessToken, refreshToken, returnTo: '/' }) })
      .then(async response => { const result = await response.json() as { error?: string; returnTo?: string }; if (!response.ok) throw new Error(result.error); location.replace(result.returnTo ?? '/'); })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Unable to confirm this account.'));
  }, []);
  return <main className="signin-page"><section className="signin-card"><div className="brand">pantrack<span className="brand-period">.</span></div><p role="status">{message}</p></section></main>;
}
