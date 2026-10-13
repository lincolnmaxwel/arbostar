'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PasswordMatch, PasswordRequirements } from '@/components/PasswordRequirements';
import { passwordProblem } from '@/lib/passwordPolicy';
import styles from '@/app/login/login.module.css';
import signupStyles from '@/app/signup/signup.module.css';

export function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailExists, setEmailExists] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setEmailExists(false);

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
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, acceptTerms, website }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not start your free trial. Please try again.');
        setEmailExists(body.code === 'email-exists');
        setSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <section className={styles.success} role="status" aria-live="polite">
        <strong>Check your email</strong>
        <p className={signupStyles.successCopy}>
          We sent a confirmation link to <strong>{email}</strong>. Check your inbox and spam folder, then use the link
          within 24 hours to confirm your address.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          {emailExists && (
            <p className={signupStyles.errorLinks}>
              <Link href="/login">Sign in</Link> or <Link href="/forgot-password">Forgot your password?</Link>
            </p>
          )}
        </div>
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
      <div className={styles.field}>
        <label htmlFor="signup-password">Password</label>
        <div className={styles.passwordWrap}>
          <input
            id="signup-password"
            className={`${styles.input} ${styles.passwordInput}`}
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            minLength={6}
            maxLength={200}
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
      <PasswordRequirements password={password} />
      <div className={styles.field}>
        <label htmlFor="signup-confirm">Confirm password</label>
        <input
          id="signup-confirm"
          className={styles.input}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={submitting}
          minLength={6}
          maxLength={200}
          required
        />
      </div>
      <PasswordMatch password={password} confirm={confirm} />
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
