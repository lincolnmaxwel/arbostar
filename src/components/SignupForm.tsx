'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from '@/app/login/login.module.css';
import signupStyles from '@/app/signup/signup.module.css';

const GENERIC_SUCCESS_MESSAGE =
  'If this email can be used to create an account, a verification link is on its way.';

export function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, acceptTerms, website }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not start your free trial. Please try again.');
        setSubmitting(false);
        return;
      }

      setSuccessMessage(body.message ?? GENERIC_SUCCESS_MESSAGE);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  if (successMessage) {
    return (
      <p className={styles.success} role="status" aria-live="polite">
        {successMessage}
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
        <label htmlFor="signup-name">Name</label>
        <input
          id="signup-name"
          className={styles.input}
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
          minLength={2}
          maxLength={100}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          className={styles.input}
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
          maxLength={254}
          required
        />
      </div>
      <div className={signupStyles.termsField}>
        <input
          id="signup-terms"
          className={signupStyles.termsCheckbox}
          type="checkbox"
          checked={acceptTerms}
          onChange={(event) => setAcceptTerms(event.target.checked)}
          disabled={submitting}
          required
        />
        <label htmlFor="signup-terms" className={signupStyles.termsLabel}>
          I agree to the{' '}
          <Link href="/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </Link>
          .
        </label>
      </div>
      <div className={signupStyles.honeypot} aria-hidden="true">
        <label htmlFor="signup-website">Website</label>
        <input
          id="signup-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <button className={styles.button} type="submit" disabled={submitting}>
        {submitting ? 'Starting your trial...' : 'Start free trial'}
      </button>
    </form>
  );
}
