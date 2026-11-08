'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../app/admin/users/admin-users.module.css';

interface PendingRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  referral: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
}

interface BlockedRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  referral: string | null;
  reason: string | null;
  createdAt: string;
}

function fmt(date: string | null): string {
  return date ? new Date(date).toLocaleString() : '-';
}

// Invite-only sign-up queue (view "approvals") and deny list (view "blocked").
export function AdminSignupRequestsClient({
  view,
  onChanged,
}: {
  view: 'approvals' | 'blocked';
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [blocked, setBlocked] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which request has its approval form open, with its two inputs.
  const [approvingId, setApprovingId] = useState<string | null>(null);
  // Which request has its denial form open, and the reason typed so far.
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [trialDays, setTrialDays] = useState('15');
  const [price, setPrice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/signup-requests', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not load sign-up requests.');
        return;
      }
      setPending(body.pending);
      setBlocked(body.blocked);
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    const days = Number(trialDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      setError('Trial length must be a whole number of days from 0 to 365.');
      return;
    }
    let priceCents: number | null = null;
    if (price.trim() !== '') {
      const dollars = Number(price.replace(/[$,]/g, ''));
      if (!Number.isFinite(dollars)) {
        setError('Enter a valid monthly price, or leave it blank for the default plan price.');
        return;
      }
      priceCents = Math.round(dollars * 100);
    }
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/signup-requests/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trialDays: days, priceCents }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not approve this request.');
        return;
      }
      setNotice(
        body.emailSent === false
          ? 'Approved, but the approval email could not be sent. Let the person know they can sign in.'
          : 'Approved. The person was emailed and can sign in now.',
      );
      setApprovingId(null);
      await load();
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function deny(row: PendingRequest) {
    const reason = denyReason.trim();
    if (!reason) {
      setError('Enter the reason for denying this request.');
      return;
    }
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/signup-requests/${row.id}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not deny this request.');
        return;
      }
      setNotice(`${row.email} was denied and added to the blocked list.`);
      setDenyingId(null);
      setDenyReason('');
      await load();
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function unblock(row: BlockedRow) {
    if (!window.confirm(`Remove ${row.email} from the blocked list? It will be able to request access again.`)) return;
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/blocked-emails/${row.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not remove this email.');
        return;
      }
      setNotice(`${row.email} was removed from the blocked list.`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className={styles.loading}>Loading...</p>;

  return (
    <div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {view === 'approvals' ? (
        <>
          <h2 className={styles.sectionTitle}>Pending approvals</h2>
          <p className={styles.userEmail}>
            People who confirmed their email and wait for you. Contact them first, then approve or deny.
          </p>
          {pending.length === 0 ? (
            <p className={styles.emptyState}>No pending requests.</p>
          ) : (
            pending.map((row) => (
              <div key={row.id} className={styles.createForm} style={{ marginBottom: 16 }}>
                <div className={styles.fieldGrid}>
                  <div className={styles.field}>
                    <strong>Name</strong>
                    <div>{row.name}</div>
                  </div>
                  <div className={styles.field}>
                    <strong>Email</strong>
                    <div>{row.email}</div>
                  </div>
                  <div className={styles.field}>
                    <strong>Phone</strong>
                    <div>{row.phone ?? '-'}</div>
                  </div>
                  <div className={styles.field}>
                    <strong>Requested</strong>
                    <div>{fmt(row.createdAt)}</div>
                  </div>
                  <div className={styles.field}>
                    <strong>Email confirmed</strong>
                    <div>{fmt(row.emailVerifiedAt)}</div>
                  </div>
                </div>
                <div className={styles.field} style={{ marginTop: 8 }}>
                  <strong>How they heard about us / who referred them</strong>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{row.referral ?? '-'}</div>
                </div>

                {approvingId === row.id ? (
                  <div style={{ marginTop: 16 }}>
                    <div className={styles.fieldGrid}>
                      <div className={styles.field}>
                        <label htmlFor={`trial-${row.id}`}>Free trial (days)</label>
                        <input
                          id={`trial-${row.id}`}
                          type="number"
                          min="0"
                          max="365"
                          step="1"
                          className={styles.input}
                          value={trialDays}
                          onChange={(e) => setTrialDays(e.target.value)}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`price-${row.id}`}>Monthly price (USD)</label>
                        <input
                          id={`price-${row.id}`}
                          type="number"
                          min="0.5"
                          max="10000"
                          step="0.01"
                          placeholder="Default plan price"
                          className={styles.input}
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                        />
                      </div>
                    </div>
                    <p className={styles.userEmail}>Leave the price blank to use the default plan price.</p>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.submitButton} disabled={busyId === row.id} onClick={() => approve(row.id)}>
                        {busyId === row.id ? 'Approving...' : 'Confirm approval'}
                      </button>
                      <button type="button" className={styles.actionButton} disabled={busyId === row.id} onClick={() => setApprovingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.rowActions} style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className={styles.submitButton}
                      disabled={busyId === row.id}
                      onClick={() => {
                        setApprovingId(row.id);
                        setDenyingId(null);
                        setError(null);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      disabled={busyId === row.id}
                      onClick={() => {
                        setDenyingId(row.id);
                        setDenyReason('');
                        setApprovingId(null);
                        setError(null);
                      }}
                    >
                      Deny
                    </button>
                  </div>
                )}

                {denyingId === row.id && (
                  <div style={{ marginTop: 16 }}>
                    <div className={styles.field}>
                      <label htmlFor={`deny-${row.id}`}>Reason for denying (saved on the blocked list)</label>
                      <textarea
                        id={`deny-${row.id}`}
                        className={styles.input}
                        rows={3}
                        maxLength={500}
                        autoFocus
                        placeholder="e.g. Not a tree service business; could not reach by phone"
                        value={denyReason}
                        onChange={(e) => setDenyReason(e.target.value)}
                      />
                    </div>
                    <p className={styles.userEmail}>
                      {row.email} will be blocked and cannot sign up again until you remove it from the blocked list.
                    </p>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.deleteButton}
                        disabled={busyId === row.id || !denyReason.trim()}
                        onClick={() => deny(row)}
                      >
                        {busyId === row.id ? 'Denying...' : 'Confirm denial'}
                      </button>
                      <button type="button" className={styles.actionButton} disabled={busyId === row.id} onClick={() => setDenyingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      ) : (
        <>
          <h2 className={styles.sectionTitle}>Blocked emails</h2>
          <p className={styles.userEmail}>
            Denied requests. These emails cannot sign up again unless you remove them from this list.
          </p>
          {blocked.length === 0 ? (
            <p className={styles.emptyState}>No blocked emails.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Referral</th>
                    <th>Reason denied</th>
                    <th>Blocked on</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((row) => (
                    <tr key={row.id}>
                      <td>{row.email}</td>
                      <td>{row.name ?? '-'}</td>
                      <td>{row.phone ?? '-'}</td>
                      <td>{row.referral ?? '-'}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{row.reason ?? '-'}</td>
                      <td>{fmt(row.createdAt)}</td>
                      <td>
                        <button type="button" className={styles.actionButton} disabled={busyId === row.id} onClick={() => unblock(row)}>
                          Remove from list
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
