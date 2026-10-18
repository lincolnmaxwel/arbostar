'use client';

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { useLivePolling } from '@/lib/useLivePolling';
import styles from '../app/admin/users/admin-users.module.css';
import sub from '../app/billing/subscriptions.module.css';

type Phase = 'exempt' | 'subscribed' | 'past_due' | 'trial' | 'trial_ended' | 'canceled';

interface SubscriptionRow {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff';
  accountStatus: 'active' | 'inactive' | 'blocked';
  billingExempt: boolean;
  phase: Phase;
  access: boolean;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  periodEnd: string | null;
  daysLeft: number | null;
  cancelAtPeriodEnd: boolean;
  autoRenews: boolean;
  customPriceCents: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface Overview {
  subscriptions: SubscriptionRow[];
  summary: { total: number; subscribed: number; trial: number; pastDue: number; locked: number; exempt: number };
  plan: { amount: number; currency: string; interval: string } | null;
  stripeMode: 'test' | 'live';
}

const PHASE_LABEL: Record<Phase, string> = {
  exempt: 'Not billed',
  subscribed: 'Subscribed',
  past_due: 'Past due',
  trial: 'Trial',
  trial_ended: 'Trial ended',
  canceled: 'Canceled',
};

const FILTERS: { key: 'all' | Phase; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'subscribed', label: 'Subscribed' },
  { key: 'trial', label: 'Trial' },
  { key: 'past_due', label: 'Past due' },
  { key: 'trial_ended', label: 'Trial ended' },
  { key: 'canceled', label: 'Canceled' },
  { key: 'exempt', label: 'Not billed' },
];

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
}

export function AdminSubscriptionsClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Phase>('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState<Record<string, string>>({});
  const [trialDates, setTrialDates] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [defaultPrice, setDefaultPrice] = useState('');
  const [applyToSubscribers, setApplyToSubscribers] = useState(false);
  const [userPrices, setUserPrices] = useState<Record<string, string>>({});
  const [priceBusy, setPriceBusy] = useState(false);

  const hasData = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/subscriptions', { cache: 'no-store' });
    if (!res.ok) {
      // A failed background refresh must not replace a list that is on screen.
      if (!hasData.current) setError(res.status === 403 ? 'Admin access required.' : 'Could not load subscriptions.');
      setLoading(false);
      return;
    }
    hasData.current = true;
    setData((await res.json()) as Overview);
    setLoading(false);
  }, []);

  // Live: new subscriptions, webhook updates and deletions show up on their own.
  useLivePolling(load, 5000);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.subscriptions.filter(
      (s) =>
        (filter === 'all' || s.phase === filter) &&
        (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)),
    );
  }, [data, filter, query]);

  async function patchUser(id: string, patch: Record<string, unknown>, okMessage: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Update failed.');
        return;
      }
      setNotice(okMessage);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // Dollars typed by the admin -> whole cents (null when it is not a number).
  function toCents(value: string): number | null {
    const n = Number(value.trim().replace(/^\$/, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }

  async function saveDefaultPrice() {
    if (!data?.plan) return;
    const cents = toCents(defaultPrice || String(data.plan.amount));
    if (cents === null) {
      setError('Enter a valid price, for example 89.00.');
      return;
    }
    const label = `$${(cents / 100).toFixed(2)}`;
    const who = applyToSubscribers
      ? 'New subscribers AND every current subscriber without a custom price will pay this from their next renewal.'
      : 'Only new subscriptions are affected; current subscribers keep what they pay now.';
    if (!window.confirm(`Set the plan price to ${label} / ${data.plan.interval}? ${who}`)) return;
    setPriceBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/billing-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceCents: cents, applyToSubscribers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not change the price.');
        return;
      }
      setNotice(
        `Plan price is now ${label}.` +
          (applyToSubscribers ? ` ${body.updated} subscription(s) updated${body.failed ? `, ${body.failed} failed (see server log)` : ''}.` : ''),
      );
      setDefaultPrice('');
      setApplyToSubscribers(false);
      await load();
    } finally {
      setPriceBusy(false);
    }
  }

  function saveUserPrice(s: SubscriptionRow, clear: boolean) {
    if (clear) {
      patchUser(s.id, { customPriceCents: null }, `${s.email} now pays the default plan price.`);
      return;
    }
    const cents = toCents(userPrices[s.id] ?? '');
    if (cents === null) {
      setError('Enter a valid price, for example 49.00.');
      return;
    }
    const live = s.phase === 'subscribed' || s.phase === 'past_due';
    if (!window.confirm(`Charge ${s.email} $${(cents / 100).toFixed(2)} instead of the default?${live ? ' Their current subscription switches to this price at the next renewal.' : ''}`)) return;
    patchUser(s.id, { customPriceCents: cents }, `${s.email} will pay $${(cents / 100).toFixed(2)}.`);
  }

  async function deleteSubscription(s: SubscriptionRow) {
    const back =
      s.trialEndsAt && new Date(s.trialEndsAt).getTime() > Date.now()
        ? `back to its free trial (ends ${fmt(s.trialEndsAt)})`
        : 'locked as "trial ended"';
    if (
      !window.confirm(
        `Delete the subscription of ${s.email}? It is canceled in Stripe immediately (no refund) and the account goes ${back}.`,
      )
    ) {
      return;
    }
    setBusyId(s.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/users/${s.id}/subscription`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not delete the subscription.');
        return;
      }
      setNotice(
        body.access
          ? `Subscription deleted. ${s.email} is back on the free trial.`
          : `Subscription deleted. ${s.email} is now locked (trial ended).`,
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // <input type="date"> works in the admin's local calendar; the trial ends at
  // the end of the chosen day.
  function localDateValue(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString('en-CA') : '';
  }

  function setTrialDate(s: SubscriptionRow) {
    const value = trialDates[s.id] ?? localDateValue(s.trialEndsAt);
    if (!value) {
      setError('Pick a date first.');
      return;
    }
    const endOfDay = new Date(`${value}T23:59:59`);
    if (Number.isNaN(endOfDay.getTime())) {
      setError('Pick a valid date.');
      return;
    }
    const lapses = endOfDay.getTime() <= Date.now();
    const lockNote =
      lapses && !(s.phase === 'subscribed' || s.phase === 'past_due')
        ? ' This ends the trial now and locks the account until it subscribes.'
        : '';
    if (!window.confirm(`Set the trial of ${s.email} to end on ${value}?${lockNote}`)) return;
    patchUser(s.id, { trialEndsAt: endOfDay.toISOString() }, `Trial end for ${s.email} set to ${value}.`);
  }

  function extendTrial(s: SubscriptionRow) {
    const days = Number(extendDays[s.id] ?? '7');
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError('Enter a whole number of days between 1 and 365.');
      return;
    }
    patchUser(s.id, { extendTrialDays: days }, `Trial extended by ${days} day${days === 1 ? '' : 's'} for ${s.email}.`);
  }

  if (loading) return <p className={styles.loading}>Loading subscriptions...</p>;
  if (!data) return <p className={styles.error} role="alert">{error ?? 'Could not load subscriptions.'}</p>;

  const dash = data.stripeMode === 'live' ? 'https://dashboard.stripe.com' : 'https://dashboard.stripe.com/test';
  const plan = data.plan;
  const mrr = plan
    ? data.subscriptions
        .filter((s) => s.phase === 'subscribed')
        .reduce((sum, s) => sum + (s.customPriceCents !== null ? s.customPriceCents / 100 : plan.amount), 0)
    : null;

  const cards: { label: string; value: string | number; hint?: string }[] = [
    { label: 'Subscribed', value: data.summary.subscribed, hint: mrr !== null && data.plan ? `~${data.plan.currency} $${mrr.toFixed(2)} / ${data.plan.interval}` : undefined },
    { label: 'On trial', value: data.summary.trial },
    { label: 'Past due', value: data.summary.pastDue },
    { label: 'Locked', value: data.summary.locked },
    { label: 'Not billed', value: data.summary.exempt },
  ];

  return (
    <div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <div className={styles.header}>
        <h1 className={styles.title}>Subscriptions</h1>
        <span className={styles.userEmail}>
          Stripe mode: <strong>{data.stripeMode === 'live' ? 'Live' : 'Sandbox'}</strong>
          {data.plan && ` · Plan: ${data.plan.currency} $${data.plan.amount.toFixed(2)} / ${data.plan.interval}`}
        </span>
      </div>

      {data.plan && (
        <section className={sub.card} style={{ marginBottom: 20 }}>
          <h3 className={sub.cardTitle}>Plan price</h3>
          <p className={sub.hint}>
            Current default: {data.plan.currency} ${data.plan.amount.toFixed(2)} / {data.plan.interval}. Accounts with their
            own price (set under Manage) are not affected by this.
          </p>
          <div className={sub.field}>
            <label className={sub.fieldLabel} htmlFor="default-price">
              New price ({data.plan.currency})
            </label>
            <div className={sub.inline}>
              <input
                id="default-price"
                type="number"
                min="0.5"
                step="0.01"
                inputMode="decimal"
                className={styles.input}
                placeholder={data.plan.amount.toFixed(2)}
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
              />
              <button type="button" className={styles.actionButton} disabled={priceBusy || !defaultPrice} onClick={saveDefaultPrice}>
                Save price
              </button>
            </div>
          </div>
          <label className={sub.hint} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={applyToSubscribers} onChange={(e) => setApplyToSubscribers(e.target.checked)} />
            Also move current subscribers to this price (from their next renewal, no refund or extra charge)
          </label>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '14px 16px',
            }}
          >
            <div className={styles.userEmail}>{c.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{c.value}</div>
            {c.hint && <div className={styles.userEmail}>{c.hint}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          className={styles.input}
          style={{ maxWidth: 280 }}
          placeholder="Search name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search subscriptions"
        />
        <select
          className={styles.input}
          style={{ maxWidth: 200 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | Phase)}
          aria-label="Filter by status"
        >
          {FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No accounts match this filter.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Status</th>
                <th>Trial ends</th>
                <th>Renewal / ends</th>
                <th aria-label="Manage"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const open = openId === s.id;
                const hasSub = !!(s.stripeSubscriptionId || s.subscriptionStatus);
                const canManage = s.role !== 'admin';
                return (
                  <Fragment key={s.id}>
                    <tr>
                      <td>
                        <div className={styles.userName}>{s.name}</div>
                        <div className={styles.userEmail}>{s.email}</div>
                        {s.role === 'admin' && <span className={styles.selfBadge}>Admin</span>}
                        {s.accountStatus !== 'active' && <div className={styles.userEmail}>Account {s.accountStatus}</div>}
                      </td>
                      <td>
                        <div className={styles.userName}>{s.billingExempt ? 'Exempt' : PHASE_LABEL[s.phase]}</div>
                        {s.subscriptionStatus && <div className={styles.userEmail}>Stripe: {s.subscriptionStatus}</div>}
                        {!s.access && <div className={styles.userEmail}>Access locked</div>}
                      </td>
                      <td>{s.phase === 'trial' ? `${fmt(s.trialEndsAt)} (${s.daysLeft}d)` : fmt(s.trialEndsAt)}</td>
                      <td>
                        {s.phase === 'subscribed' || s.phase === 'past_due' ? (
                          <>
                            <div>{fmt(s.periodEnd)}</div>
                            <div className={styles.userEmail}>
                              {s.cancelAtPeriodEnd ? 'Cancels at period end' : s.autoRenews ? 'Auto-renews' : ''}
                              {s.daysLeft !== null ? ` · ${s.daysLeft}d left` : ''}
                            </div>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {canManage ? (
                          <button
                            type="button"
                            className={styles.actionButton}
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : s.id)}
                          >
                            {open ? 'Close' : 'Manage'}
                          </button>
                        ) : (
                          <span className={styles.userEmail}>-</span>
                        )}
                      </td>
                    </tr>
                    {open && canManage && (
                      <tr>
                        <td colSpan={5} className={sub.panelCell}>
                          <div className={sub.panel}>
                            <section className={sub.card}>
                              <h3 className={sub.cardTitle}>Trial</h3>
                              <p className={sub.hint}>
                                {s.trialEndsAt
                                  ? `Ends ${fmt(s.trialEndsAt)}${s.phase === 'trial' ? ` (${s.daysLeft} days left)` : ''}.`
                                  : 'No trial date set.'}
                                {hasSub && ' It only matters again if the subscription is deleted or ends.'}
                              </p>
                              <div className={sub.field}>
                                <label className={sub.fieldLabel} htmlFor={`add-${s.id}`}>
                                  Add days
                                </label>
                                <div className={sub.inline}>
                                  <input
                                    id={`add-${s.id}`}
                                    type="number"
                                    min="1"
                                    max="365"
                                    className={styles.input}
                                    value={extendDays[s.id] ?? '7'}
                                    onChange={(e) => setExtendDays((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                  />
                                  <button
                                    type="button"
                                    className={styles.actionButton}
                                    disabled={busyId === s.id}
                                    onClick={() => extendTrial(s)}
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                              <div className={sub.field}>
                                <label className={sub.fieldLabel} htmlFor={`date-${s.id}`}>
                                  Or set an exact end date
                                </label>
                                <div className={sub.inline}>
                                  <input
                                    id={`date-${s.id}`}
                                    type="date"
                                    className={styles.input}
                                    value={trialDates[s.id] ?? localDateValue(s.trialEndsAt)}
                                    onChange={(e) => setTrialDates((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                  />
                                  <button
                                    type="button"
                                    className={styles.actionButton}
                                    disabled={busyId === s.id}
                                    onClick={() => setTrialDate(s)}
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            </section>

                            {data.plan && (
                              <section className={sub.card}>
                                <h3 className={sub.cardTitle}>Price</h3>
                                <p className={sub.hint}>
                                  {s.customPriceCents !== null
                                    ? `Custom price: ${data.plan.currency} $${(s.customPriceCents / 100).toFixed(2)} / ${data.plan.interval}.`
                                    : `Pays the default price (${data.plan.currency} $${data.plan.amount.toFixed(2)} / ${data.plan.interval}).`}
                                </p>
                                <div className={sub.field}>
                                  <label className={sub.fieldLabel} htmlFor={`price-${s.id}`}>
                                    Own price
                                  </label>
                                  <div className={sub.inline}>
                                    <input
                                      id={`price-${s.id}`}
                                      type="number"
                                      min="0.5"
                                      step="0.01"
                                      inputMode="decimal"
                                      className={styles.input}
                                      placeholder={(s.customPriceCents !== null ? s.customPriceCents / 100 : data.plan.amount).toFixed(2)}
                                      value={userPrices[s.id] ?? ''}
                                      onChange={(e) => setUserPrices((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                    />
                                    <button
                                      type="button"
                                      className={styles.actionButton}
                                      disabled={busyId === s.id || !userPrices[s.id]}
                                      onClick={() => saveUserPrice(s, false)}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                                {s.customPriceCents !== null && (
                                  <div>
                                    <button
                                      type="button"
                                      className={styles.actionButton}
                                      disabled={busyId === s.id}
                                      onClick={() => saveUserPrice(s, true)}
                                    >
                                      Use default price
                                    </button>
                                  </div>
                                )}
                              </section>
                            )}

                            <section className={sub.card}>
                              <h3 className={sub.cardTitle}>Billing</h3>
                              <p className={sub.hint}>
                                {s.billingExempt
                                  ? 'This account is exempt: it is never charged and never locked.'
                                  : 'Exempt accounts are never charged and never locked (partners, internal accounts). An existing Stripe subscription keeps billing.'}
                              </p>
                              <div>
                                <button
                                  type="button"
                                  className={styles.actionButton}
                                  disabled={busyId === s.id}
                                  onClick={() =>
                                    patchUser(
                                      s.id,
                                      { billingExempt: !s.billingExempt },
                                      s.billingExempt
                                        ? `${s.email} now follows the normal trial/subscription rules.`
                                        : `${s.email} is exempt from billing.`,
                                    )
                                  }
                                >
                                  {s.billingExempt ? 'Remove exemption' : 'Make exempt'}
                                </button>
                              </div>
                              {s.stripeCustomerId && (
                                <div className={sub.field}>
                                  <span className={sub.fieldLabel}>Open in Stripe</span>
                                  <div className={sub.links}>
                                    <a
                                      className={styles.actionButton}
                                      href={`${dash}/customers/${s.stripeCustomerId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Customer
                                    </a>
                                    {s.stripeSubscriptionId && (
                                      <a
                                        className={styles.actionButton}
                                        href={`${dash}/subscriptions/${s.stripeSubscriptionId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        Subscription
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
                            </section>

                            {hasSub && (
                              <section className={`${sub.card} ${sub.cardDanger}`}>
                                <h3 className={sub.cardTitle}>Danger zone</h3>
                                <p className={sub.hint}>
                                  Cancels the subscription in Stripe right away (no refund). The account goes back to its
                                  free trial if it is still running, or is locked as &quot;trial ended&quot;.
                                </p>
                                <div>
                                  <button
                                    type="button"
                                    className={styles.deleteButton}
                                    disabled={busyId === s.id}
                                    onClick={() => deleteSubscription(s)}
                                  >
                                    Delete subscription
                                  </button>
                                </div>
                              </section>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.userEmail} style={{ marginTop: 12 }}>
        To cancel, refund or change a paid subscription, open it in Stripe with the Open in Stripe links under Manage; the
        webhook updates this list automatically.
      </p>
    </div>
  );
}
