'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import styles from '@/app/login/login.module.css';

export function VerifySignupForm({ token, email, name }: { token: string; email: string; name: string }) {
  const [fullName, setFullName] = useState(name);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
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
      const response = await fetch(`/api/signup/verify/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, name: fullName }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not create your account. Please try again.');
        setSubmitting(false);
        return;
      }

      await signIn('credentials', { email: body.email ?? email, password, redirect: false });
      window.location.href = '/quotes';
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
        <label htmlFor="verify-signup-email">Email</label>
        <input id="verify-signup-email" className={styles.input} type="email" value={email} readOnly disabled />
      </div>
      <div className={styles.field}>
        <label htmlFor="verify-signup-name">Name</label>
        <input
          id="verify-signup-name"
          className={styles.input}
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          disabled={submitting}
          minLength={2}
          maxLength={100}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="verify-signup-password">Password</label>
        <div className={styles.passwordWrap}>
          <input
            id="verify-signup-password"
            className={`${styles.input} ${styles.passwordInput}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={6}
            maxLength={200}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            tabIndex={-1}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor="verify-signup-confirm">Confirm password</label>
        <input
          id="verify-signup-confirm"
          className={styles.input}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
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
