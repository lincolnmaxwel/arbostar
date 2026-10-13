'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { PasswordMatch, PasswordRequirements } from '@/components/PasswordRequirements';
import { passwordProblem } from '@/lib/passwordPolicy';
import styles from '@/app/login/login.module.css';

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/password/reset/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not reset your password. Please try again.');
        setSubmitting(false);
        return;
      }

      // Password changed — sign in with it. Full navigation so the session
      // cookie is on the request (same reason as the login page).
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
        <label htmlFor="reset-password">New password</label>
        <div className={styles.passwordWrap}>
          <input
            id="reset-password"
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
      <PasswordRequirements password={password} />
      <div className={styles.field}>
        <label htmlFor="reset-confirm">Confirm password</label>
        <input
          id="reset-confirm"
          className={styles.input}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          required
        />
      </div>
      <PasswordMatch password={password} confirm={confirm} />
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? 'Saving...' : 'Set new password'}
      </button>
    </form>
  );
}
