'use client';
import { useEffect, useState } from 'react';

export default function InviteAcceptance({ token }: { token: string }) {
  const [message, setMessage] = useState('Joining company…');
  useEffect(() => { void (async () => {
    const response = await fetch('/api/memberships', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', token, returnTo: '/' }) });
    const result = await response.json() as { error?: string; returnTo?: string };
    if (!response.ok) { setMessage(result.error ?? 'Unable to accept this invitation.'); return; }
    location.replace(result.returnTo ?? '/');
  })(); }, [token]);
  return <main className="empty"><h1>{message}</h1><p>If this link was sent to a different email address, sign out and use that account.</p></main>;
}
