'use client';
import { useState } from 'react';
import { CircleAlert, ExternalLink, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AuthShell from '../auth/auth-shell';
export default function Invite() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setError('');
    try {
      const token = new URLSearchParams(location.hash.slice(1)).get('token');
      const r = await fetch('/api/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accept', token }),
        }),
        d = (await r.json()) as { error?: string; companyId: string };
      if (!r.ok) throw new Error(d.error || 'Please retry.');
      history.replaceState(null, '', '/invite');
      location.assign('/?company=' + encodeURIComponent(d.companyId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell>
      <div className="auth-form">
        <span className="auth-sent-icon" aria-hidden="true">
          <UsersRound size={26} />
        </span>
        <h1>You’re invited to join a café</h1>
        <p className="auth-lead">Two quick steps and you’ll be in.</p>
        <ol className="auth-steps">
          <li>
            <strong>Sign in with the email that got this invitation.</strong>
            <span>
              No account yet? Create one with that email.{' '}
              <a href="/auth" target="_blank" rel="noreferrer">
                Open sign-in in a new tab <ExternalLink size={13} aria-hidden="true" />
              </a>
            </span>
          </li>
          <li>
            <strong>Come back to this tab and accept.</strong>
          </li>
        </ol>
        {error && (
          <p className="auth-notice auth-notice-error" role="alert">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        <Button className="auth-submit" disabled={busy} onClick={() => void accept()}>
          {busy ? 'Joining…' : 'Accept invitation'}
        </Button>
        <p className="auth-hint">Invitations expire after seven days and can be used once.</p>
      </div>
    </AuthShell>
  );
}
