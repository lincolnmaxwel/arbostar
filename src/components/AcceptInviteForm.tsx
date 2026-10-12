'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import styles from '@/app/login/login.module.css';

export function AcceptInviteForm({ token, email, name }: { token: string; email: string; name: string }) {
  const [fullName, setFullName] = useState(name);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, name: fullName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not create your account. Please try again.');
        setSubmitting(false);
        return;
      }

      // Account exists now — sign in with the password just chosen. A full
      // navigation (not router.push) so the session cookie is on the request,
      // same reason as the login page.
      const result = await signIn('credentials', { email, password, redirect: false });
      window.location.href = result?.error ? '/login' : '/quotes';
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" className={styles.input} type="email" value={email} readOnly disabled />
      </div>
      <div className={styles.field}>
        <label htmlFor="invite-name">Name</label>
        <input
          id="invite-name"
          className={styles.input}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          disabled={submitting}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="invite-password">Password</label>
        <div className={styles.passwordWrap}>
          <input
            id="invite-password"
            className={`${styles.input} ${styles.passwordInput}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            tabIndex={-1}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor="invite-confirm">Confirm password</label>
        <input
          id="invite-confirm"
          className={styles.input}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          required
        />
      </div>
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  );
}
