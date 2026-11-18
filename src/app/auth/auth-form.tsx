'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowLeft, Circle, CircleAlert, CircleCheck, Eye, EyeOff, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  hasPasswordSpecialCharacter,
  isValidNewPassword,
  NEW_PASSWORD_MIN_LENGTH,
  NEW_PASSWORD_REQUIREMENT,
} from '@/lib/password-policy';

type Action = 'signin' | 'signup' | 'recover';
type Notice = { kind: 'error' | 'ok'; text: string } | null;
const noSubscription = () => () => {};

function PasswordField({
  value,
  onChange,
  isNew,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  isNew: boolean;
  label: string;
}) {
  const [shown, setShown] = useState(false);
  const longEnough = value.length >= NEW_PASSWORD_MIN_LENGTH,
    special = hasPasswordSpecialCharacter(value);
  return (
    <div className="auth-field">
      <label htmlFor="auth-password">{label}</label>
      <div className="auth-password">
        <Input
          id="auth-password"
          type={shown ? 'text' : 'password'}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          minLength={isNew ? NEW_PASSWORD_MIN_LENGTH : 1}
          aria-describedby={isNew ? 'new-password-requirement' : undefined}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="auth-reveal"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {isNew && (
        <ul
          id="new-password-requirement"
          className="auth-rules"
          aria-label={NEW_PASSWORD_REQUIREMENT}
        >
          {(
            [
              [longEnough, `At least ${NEW_PASSWORD_MIN_LENGTH} characters`],
              [special, 'At least one symbol, like ! or #'],
            ] as const
          ).map(([met, text]) => (
            <li key={text} data-met={met ? 'yes' : 'no'}>
              {met ? (
                <CircleCheck size={15} aria-hidden="true" />
              ) : (
                <Circle size={15} aria-hidden="true" />
              )}
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AuthForm({
  mode = 'signin',
}: {
  mode?: 'signin' | 'signout' | 'callback';
}) {
  const [action, setAction] = useState<Action>('signin'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [notice, setNotice] = useState<Notice>(null),
    [sentTo, setSentTo] = useState(''),
    [busy, setBusy] = useState(false),
    [recovery, setRecovery] = useState(false);

  // After a password reset the page reopens with ?updated=1; show that once until the next action.
  const justUpdated = useSyncExternalStore(
      noSubscription,
      () => mode === 'signin' && new URLSearchParams(location.search).get('updated') === '1',
      () => false,
    ),
    [updatedSeen, setUpdatedSeen] = useState(false);
  const shownNotice: Notice =
    notice ??
    (justUpdated && !updatedSeen
      ? { kind: 'ok', text: 'Password updated. Sign in with your new password.' }
      : null);

  function switchTo(next: Action) {
    setUpdatedSeen(true);
    setAction(next);
    setNotice(null);
    setPassword('');
    setSentTo('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setUpdatedSeen(true);
    try {
      const query = new URLSearchParams(location.search);
      const chosen =
        mode === 'signout'
          ? 'signout'
          : recovery
            ? 'password'
            : mode === 'callback'
              ? 'verify'
              : action;
      if ((chosen === 'signup' || chosen === 'password') && !isValidNewPassword(password))
        throw new Error(NEW_PASSWORD_REQUIREMENT);
      const body =
        chosen === 'verify'
          ? { action: chosen, token_hash: query.get('token_hash'), type: query.get('type') }
          : { action: chosen, email, password };
      const r = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        d = (await r.json()) as { error?: string; message: string; recovery?: boolean };
      if (!r.ok) throw new Error(d.error || 'Please retry.');
      setPassword('');
      if (d.recovery) {
        setRecovery(true);
        history.replaceState(null, '', '/auth/callback');
        return;
      }
      if (chosen === 'password') {
        location.assign('/auth?updated=1');
        return;
      }
      if (['signin', 'verify', 'signout'].includes(chosen)) {
        const next = query.get('next') || '/',
          url = new URL(next, location.origin);
        location.assign(
          url.origin === location.origin &&
            next.startsWith('/') &&
            !url.pathname.startsWith('/auth')
            ? url.pathname + url.search
            : '/',
        );
      } else setSentTo(email);
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const noticeBox = shownNotice && (
    <p
      className={`auth-notice auth-notice-${shownNotice.kind}`}
      role={shownNotice.kind === 'error' ? 'alert' : 'status'}
    >
      {shownNotice.kind === 'error' ? (
        <CircleAlert size={17} aria-hidden="true" />
      ) : (
        <CircleCheck size={17} aria-hidden="true" />
      )}
      <span>{shownNotice.text}</span>
    </p>
  );

  if (sentTo)
    return (
      <div className="auth-form auth-sent" role="status">
        <span className="auth-sent-icon" aria-hidden="true">
          <MailCheck size={26} />
        </span>
        <h1>Check your email</h1>
        <p className="auth-lead">
          If <strong>{sentTo}</strong> can be used, we’ve sent it a link to{' '}
          {action === 'signup' ? 'confirm your new account' : 'choose a new password'}. The link
          works once.
        </p>
        <p className="auth-hint">Nothing after a few minutes? Check your spam folder.</p>
        <button type="button" className="auth-back" onClick={() => switchTo('signin')}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
        </button>
      </div>
    );

  if (mode === 'signout')
    return (
      <form onSubmit={submit} className="auth-form">
        <h1>Sign out of Pantrack?</h1>
        <p className="auth-lead">You’ll need your email and password to come back in.</p>
        {noticeBox}
        <Button className="auth-submit" disabled={busy}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Button>
        <Link className="auth-back" href="/">
          <ArrowLeft size={15} aria-hidden="true" /> Stay signed in
        </Link>
      </form>
    );

  if (mode === 'callback' && !recovery)
    return (
      <form onSubmit={submit} className="auth-form">
        <h1>Confirm your email</h1>
        <p className="auth-lead">Press the button to finish. This link only works once.</p>
        {noticeBox}
        <Button className="auth-submit" disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm and continue'}
        </Button>
        <a className="auth-back" href="/auth">
          <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
        </a>
      </form>
    );

  if (recovery)
    return (
      <form onSubmit={submit} className="auth-form">
        <h1>Choose a new password</h1>
        <p className="auth-lead">You’ll use it the next time you sign in.</p>
        <PasswordField value={password} onChange={setPassword} isNew label="New password" />
        {noticeBox}
        <Button className="auth-submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    );

  if (action === 'recover')
    return (
      <form onSubmit={submit} className="auth-form">
        <h1>Reset your password</h1>
        <p className="auth-lead">Enter your email and we’ll send a link to choose a new one.</p>
        <div className="auth-field">
          <label htmlFor="auth-email">Email</label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {noticeBox}
        <Button className="auth-submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </Button>
        <button type="button" className="auth-back" onClick={() => switchTo('signin')}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
        </button>
      </form>
    );

  const signup = action === 'signup';
  return (
    <form onSubmit={submit} className="auth-form">
      <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
        {(['signin', 'signup'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={action === v}
            onClick={() => switchTo(v)}
          >
            {v === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p className="auth-lead">
        {signup
          ? 'Start with your email. Next you can set up your café, or join your team’s.'
          : 'Sign in to your café’s stock, recipes and orders.'}
      </p>
      <div className="auth-field">
        <label htmlFor="auth-email">Email</label>
        <Input
          id="auth-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <PasswordField
        value={password}
        onChange={setPassword}
        isNew={signup}
        label={signup ? 'Choose a password' : 'Password'}
      />
      {!signup && (
        <button type="button" className="auth-link auth-forgot" onClick={() => switchTo('recover')}>
          Forgot password?
        </button>
      )}
      {noticeBox}
      <Button className="auth-submit" disabled={busy}>
        {busy
          ? signup
            ? 'Creating account…'
            : 'Signing in…'
          : signup
            ? 'Create account'
            : 'Sign in'}
      </Button>
    </form>
  );
}
