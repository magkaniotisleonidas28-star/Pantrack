'use client';

import { useState } from 'react';

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try { await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'signOut' }) }); }
    finally { location.assign('/'); }
  }
  return <button type="button" className="auth-signout" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</button>;
}
