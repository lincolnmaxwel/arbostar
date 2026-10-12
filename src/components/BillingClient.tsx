'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { resetViewContext } from '@/lib/clientUserContext';
import { useLivePolling } from '@/lib/useLivePolling';
import type { BillingInfo } from '@/lib/billing';
import styles from '../app/billing/billing.module.css';

interface BillingResponse {
  billing: BillingInfo;
  configured: boolean;
  plan: { amount: number; currency: string; interval: string } | null;
  trialDays: number;
  renewWindowDays: number;
  subscribePreview: { firstRenewalAt: string } | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const PHASE_BADGE: Record<BillingInfo['phase'], { label: string; tone: string }> = {
  exempt: { label: 'No subscription needed', tone: styles.badgeGood },
  subscribed: { label: 'Active', tone: styles.badgeGood },
  past_due: { label: 'Payment issue', tone: styles.badgeBad },
  trial: { label: 'Free trial', tone: styles.badgeInfo },
  trial_ended: { label: 'Trial ended', tone: styles.badgeBad },
  canceled: { label: 'Canceled', tone: styles.badgeBad },
};

const POLL_MS = 5000;
// How long the post-checkout "confirming" notice may wait for the webhook.
const CONFIRM_WINDOW_MS = 45000;

export function BillingClient() {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingUntil, setConfirmingUntilState] = useState<number | null>(null);
  // Mirror of confirmingUntil readable inside load() without a stale closure.
  const confirmingRef = useRef<number | null>(null);
  const setConfirmingUntil = useCallback((value: number | null) => {
    confirmingRef.current = value;
    setConfirmingUntilState(value);
  }, []);
  const [busy, setBusy] = useState<'checkout' | 'portal' | 'renew' | null>(null);
  const lastPhase = useRef<BillingInfo['phase'] | null>(null);
  const hasData = useRef(false);

  const load = useCallback(async (): Promise<BillingResponse | null> => {
    const res = await fetch('/api/billing', { cache: 'no-store' });
    if (!res.ok) {
      // A failed refresh must not wipe a screen that already has data.
      if (!hasData.current) setError('Could not load your subscription. Please try again.');
      setLoading(false);
      return null;
    }
    const body = (await res.json()) as BillingResponse;
    hasData.current = true;
    setError(null);
    setData(body);
    setLoading(false);

    // Any change of state (paid, deleted, canceled, trial over...) makes older
    // transient messages stale, and the header/gate must re-evaluate access.
    const phase = body.billing.phase;
    const wasConfirming = confirmingRef.current !== null;
    if (lastPhase.current !== null && lastPhase.current !== phase) {
      setNotice(null);
      setConfirmingUntil(null);
      resetViewContext();
      window.dispatchEvent(new Event('myjobbs:billing-changed'));
    }
    lastPhase.current = phase;

    if (wasConfirming && (phase === 'subscribed' || phase === 'past_due')) {
      setConfirmingUntil(null);
      setNotice('Your subscription is active. Thank you!');
    }
    return body;
  }, [setConfirmingUntil]);

  // Live refresh: pick up webhook results, admin changes and other tabs.
  useLivePolling(load, POLL_MS);

  // Read the post-checkout flag once, then drop it from the URL so a reload
  // does not replay the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (!checkout) return;
    if (checkout === 'canceled') setNotice('Checkout was canceled. You have not been charged.');
    if (checkout === 'success') setConfirmingUntil(Date.now() + CONFIRM_WINDOW_MS);
    window.history.replaceState(null, '', window.location.pathname);
  }, [setConfirmingUntil]);

  // The confirming notice must not outlive its window if the webhook never lands.
  useEffect(() => {
    if (confirmingUntil === null) return;
    const wait = Math.max(0, confirmingUntil - Date.now());
    const t = setTimeout(() => {
      setConfirmingUntil(null);
      setNotice('Your payment is still being confirmed. This page updates by itself as soon as it is.');
    }, wait);
    return () => clearTimeout(t);
  }, [confirmingUntil, setConfirmingUntil]);

  async function go(kind: 'checkout' | 'portal') {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/billing/${kind}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        setError(body.error ?? 'Something went wrong. Please try again.');
        return;
      }
      window.location.href = body.url as string;
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function renew() {
    setBusy('renew');
    setError(null);
    try {
      const res = await fetch('/api/billing/renew', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not renew the subscription.');
        return;
      }
      setNotice('Your subscription will renew automatically. Thank you!');
      resetViewContext();
      await load();
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p>Loading your subscription...</p>;
  if (!data) {
    return (
      <div className={styles.wrap}>
        <p className={`${styles.alert} ${styles.alertError}`} role="alert">
          {error ?? 'Could not load your subscription.'}
        </p>
      </div>
    );
  }

  const { billing, plan, configured, subscribePreview } = data;
  const badge = PHASE_BADGE[billing.phase];
  const price = plan
    ? `${plan.currency} $${plan.amount.toFixed(2)} / ${plan.interval}`
    : null;
  const unavailable = !configured && !(billing.phase === 'exempt');

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Subscription</h1>

      {error && (
        <p className={`${styles.alert} ${styles.alertError}`} role="alert">
          {error}
        </p>
      )}
      {confirmingUntil !== null && (
        <p className={`${styles.alert} ${styles.alertOk}`} role="status">
          Thanks! Confirming your payment...
        </p>
      )}
      {confirmingUntil === null && notice && (
        <p className={`${styles.alert} ${styles.alertOk}`} role="status">
          {notice}
        </p>
      )}
      {unavailable && (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="status">
          Online payments are not available yet. Please contact support to activate your subscription.
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.statusRow}>
          <span className={`${styles.badge} ${badge.tone}`}>{badge.label}</span>
          {price && <span className={styles.plan}>MyJobbs · {price}</span>}
        </div>

        {billing.phase === 'exempt' && (
          <p className={styles.lead}>Your account is not billed. There is nothing to manage here.</p>
        )}

        {billing.phase === 'trial' && (
          <p className={styles.lead}>
            You are on a free trial with {plural(billing.daysLeft ?? 0, 'day')} left (ends {formatDate(billing.trialEndsAt)}).{' '}
            {subscribePreview
              ? `Subscribe now and you keep every trial day: the first period is billed today and your first renewal is on ${formatDate(subscribePreview.firstRenewalAt)}.`
              : 'Subscribe any time to keep using MyJobbs after the trial.'}
          </p>
        )}

        {billing.phase === 'trial_ended' && (
          <p className={styles.lead}>
            Your free trial has ended. Your data is safe: subscribe to pick up right where you left off.
          </p>
        )}

        {billing.phase === 'canceled' && (
          <p className={styles.lead}>
            Your subscription has ended. Your data is safe: subscribe again to get back in.
          </p>
        )}

        {billing.phase === 'subscribed' && billing.autoRenews && (
          <p className={styles.lead}>
            Your subscription renews automatically on {formatDate(billing.periodEnd)}.
          </p>
        )}

        {billing.phase === 'subscribed' && billing.cancelAtPeriodEnd && (
          <p className={styles.lead}>
            Your subscription is set to end on {formatDate(billing.periodEnd)} ({plural(billing.daysLeft ?? 0, 'day')}{' '}
            left). Renew to keep your access without interruption.
          </p>
        )}

        {billing.phase === 'past_due' && (
          <p className={styles.lead}>
            We could not process your last payment. Update your payment method to avoid losing access.
          </p>
        )}

        {billing.phase !== 'exempt' && (
          <dl className={styles.facts}>
            {billing.phase === 'trial' && (
              <>
                <div className={styles.fact}>
                  <dt>Trial ends</dt>
                  <dd>{formatDate(billing.trialEndsAt)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Days left</dt>
                  <dd>{billing.daysLeft}</dd>
                </div>
              </>
            )}
            {(billing.phase === 'subscribed' || billing.phase === 'past_due') && (
              <>
                <div className={styles.fact}>
                  <dt>{billing.cancelAtPeriodEnd ? 'Ends on' : 'Next renewal'}</dt>
                  <dd>{formatDate(billing.periodEnd)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>Days left</dt>
                  <dd>{billing.daysLeft}</dd>
                </div>
              </>
            )}
            {billing.phase === 'canceled' && (
              <div className={styles.fact}>
                <dt>Ended</dt>
                <dd>{formatDate(billing.periodEnd)}</dd>
              </div>
            )}
          </dl>
        )}

        <div className={styles.actions}>
          {billing.canSubscribe && configured && (
            <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => go('checkout')}>
              {busy === 'checkout' ? 'Redirecting...' : billing.phase === 'trial' ? 'Subscribe now' : 'Subscribe'}
            </button>
          )}
          {billing.canRenew && (
            <button type="button" className={styles.primary} disabled={busy !== null} onClick={renew}>
              {busy === 'renew' ? 'Renewing...' : 'Renew subscription'}
            </button>
          )}
          {billing.phase === 'past_due' && configured && billing.canManage && (
            <button type="button" className={styles.primary} disabled={busy !== null} onClick={() => go('portal')}>
              {busy === 'portal' ? 'Opening...' : 'Update payment method'}
            </button>
          )}
          {billing.canManage && configured && billing.phase !== 'past_due' && (
            <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => go('portal')}>
              {busy === 'portal' ? 'Opening...' : 'Manage billing'}
            </button>
          )}
        </div>

        {billing.phase !== 'exempt' && (
          <p className={styles.note}>
            Payments are processed securely by Stripe. Use &ldquo;Manage billing&rdquo; to update your card, see past invoices or
            cancel.
          </p>
        )}
      </section>
    </div>
  );
}
