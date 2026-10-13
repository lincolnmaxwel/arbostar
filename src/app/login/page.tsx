'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import styles from './login.module.css';

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 004.24 4.24M9.88 5.09A10.6 10.6 0 0112 5c5 0 9 3.6 10 7-.4 1.36-1.2 2.7-2.26 3.87M6.6 6.6C4.4 8 2.8 10.1 2 12c.6 2 2 3.9 3.9 5.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12c1-3.4 5-7 10-7s9 3.6 10 7c-1 3.4-5 7-10 7s-9-3.6-10-7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const reason = query.get('reason');
    if (reason === 'other-device') {
      setSignedOutNotice(
        'You were signed out because this account was signed in on another device, or an administrator changed it. Only one device can use an account at a time.',
      );
    } else if (reason === 'account') {
      setSignedOutNotice('Your account has been blocked or deactivated. Contact support if you think this is a mistake.');
    }
    setEmailVerified(query.get('verified') === '1');
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Without this, tapping "Sign in" gives no visible feedback until the
    // request resolves — on a slow connection that reads as "the button
    // isn't working," inviting repeat taps that fire duplicate sign-in
    // attempts.
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await signIn('credentials', { email, password, redirect: false });
    setSubmitting(false);
    if (result?.error) {
      if (result.error === 'Account is inactive.' || result.error === 'Account is blocked.') {
        setError(result.error);
      } else {
        setError('Invalid email or password');
      }
      return;
    }
    // A client-side router.push() here raced Safari (and some Edge
    // configurations): the session cookie from the fetch() above isn't
    // always guaranteed to be committed in time for the very next request
    // if that request comes from an SPA transition instead of a full
    // navigation, so middleware saw no session and bounced straight back to
    // /login — even with correct credentials. A full navigation forces a
    // fresh request that's guaranteed to carry the cookie, no race. Chrome
    // never had this race, which is why it "only worked in Chrome."
    window.location.href = '/quotes';
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
        </h1>
        <p className={styles.subtitle}>Sign in to your account</p>

        {signedOutNotice && !error && (
          <p className={styles.success} role="status">
            {signedOutNotice}
          </p>
        )}
        {emailVerified && !error && (
          <p className={styles.success} role="status">
            Email confirmed. Sign in to start your free trial.
          </p>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className={styles.input}
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <div className={styles.passwordWrap}>
              <input
                id="password"
                className={`${styles.input} ${styles.passwordInput}`}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>
          </div>
          <button className={styles.button} type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className={styles.links}>
          <Link href="/forgot-password" className={styles.linkButton}>
            Forgot your password?
          </Link>
          <Link href="/signup" className={styles.linkButton}>
            Create an account
          </Link>
          <Link href="/" className={`${styles.linkButton} ${styles.linkButtonOutline}`}>
            Back to home
          </Link>
          <div className={styles.legalLinks}>
            <Link href="/terms">Terms of Service</Link>
            <span aria-hidden="true">·</span>
            <Link href="/privacy">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
