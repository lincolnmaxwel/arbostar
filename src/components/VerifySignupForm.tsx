'use client';

import { useState } from 'react';
import styles from '@/app/login/login.module.css';

export function VerifySignupForm({ token }: { token: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/signup/verify/${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not create your account. Please try again.');
        setSubmitting(false);
        return;
      }

      window.location.href = '/login?verified=1';
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
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? 'Confirming your email...' : 'Confirm my email'}
      </button>
    </form>
  );
}
