'use client';

import { useState } from 'react';
import styles from '@/app/login/login.module.css';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not send the reset link. Please try again.');
      } else {
        setMessage(body.message ?? 'If an account exists for that email, a reset link is on its way.');
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (message) {
    return (
      <p className={styles.success} role="status">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor="forgot-email">Email</label>
        <input
          id="forgot-email"
          className={styles.input}
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          required
        />
      </div>
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? 'Sending...' : 'Send reset link'}
      </button>
    </form>
  );
}
