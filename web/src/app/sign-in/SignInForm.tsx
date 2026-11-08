'use client';
import Link from 'next/link';
import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';

export function SignInForm() {
  const supabase = getBrowserSupabase();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (!supabase) {
    return (
      <>
        <h1 className="heading text-2xl">Accounts aren’t switched on yet</h1>
        <p className="mt-3 text-sm text-fg-2">
          This copy of WOVEXA runs in local mode. You can design, preview and export without an account; projects save in this browser.
        </p>
        <Link href="/dashboard" className="btn btn-ink mt-6 w-full">
          Continue without an account
        </Link>
      </>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) {
          setState('error');
          setMessage(error.status === 429 ? 'Too many attempts. Wait a minute, then try again.' : 'The sign-in link couldn’t be sent. Check the address and try again.');
        } else {
          setState('sent');
        }
      }}
    >
      <h1 className="heading text-2xl">Sign in</h1>
      {state === 'sent' ? (
        <p className="mt-3 text-sm" role="status">
          Check {email} for a sign-in link. It works once and expires in an hour.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-fg-2">We’ll email you a link. No password needed.</p>
          <label className="mt-5 grid gap-1.5">
            <span className="label">Email</span>
            <input className="field h-11 text-base" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {state === 'error' ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {message}
            </p>
          ) : null}
          <button className="btn btn-ink mt-5 w-full" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
          </button>
          <Link href="/dashboard" className="mt-4 block text-center text-sm text-fg-2 underline underline-offset-4">
            Continue without an account
          </Link>
        </>
      )}
    </form>
  );
}
