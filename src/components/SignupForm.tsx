'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PasswordMatch, PasswordRequirements } from '@/components/PasswordRequirements';
import { passwordProblem } from '@/lib/passwordPolicy';
import { formatPhoneInput } from '@/lib/formatPhone';
import { phoneProblem, referralProblem, referralWordCount, REFERRAL_MAX_LENGTH, REFERRAL_MIN_WORDS } from '@/lib/signups';
import { RobotCheckModal } from '@/components/RobotCheckModal';
import styles from '@/app/login/login.module.css';
import signupStyles from '@/app/signup/signup.module.css';

export function SignupForm({ turnstileSiteKey = '' }: { turnstileSiteKey?: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [referral, setReferral] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [website, setWebsite] = useState('');
  const [checkingRobot, setCheckingRobot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailExists, setEmailExists] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setEmailExists(false);

    const contactProblem = phoneProblem(phone) ?? referralProblem(referral);
    if (contactProblem) {
      setError(contactProblem);
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    // The robot check lives in its own dialog (it is tall and stays on screen
    // after passing); it submits the form itself once it has a token.
    if (turnstileSiteKey) {
      setCheckingRobot(true);
      return;
    }

    await send('');
  }

  async function send(turnstileToken: string) {
    setSubmitting(true);

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, referral, password, acceptTerms, website, turnstileToken }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? 'Could not send your request. Please try again.');
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
          within 24 hours. After you confirm, our team reviews your request and contacts you.
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
        <label htmlFor="signup-phone">Phone</label>
        <input
          id="signup-phone"
          className={styles.input}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(555) 123-4567"
          value={phone}
          onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
          disabled={submitting}
          maxLength={14}
          required
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="signup-referral">How did you hear about us?</label>
        <textarea
          id="signup-referral"
          className={styles.input}
          rows={2}
          placeholder="Who referred you? Tell us a little (at least 3 words)"
          value={referral}
          onChange={(event) => setReferral(event.target.value)}
          disabled={submitting}
          maxLength={REFERRAL_MAX_LENGTH}
          required
        />
        <small className={signupStyles.successCopy}>
          {referralWordCount(referral)}/{REFERRAL_MIN_WORDS} words minimum
        </small>
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
        {submitting ? 'Sending your request...' : 'Request access'}
      </button>
      {checkingRobot && (
        <RobotCheckModal
          siteKey={turnstileSiteKey}
          message="Please confirm you are human. Your sign-up continues right after."
          onCancel={() => setCheckingRobot(false)}
          onVerified={(token) => {
            setCheckingRobot(false);
            void send(token);
          }}
        />
      )}
    </form>
  );
}
