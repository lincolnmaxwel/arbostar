'use client';

import { useEffect, useState } from 'react';
import type { PaymentRow } from '@/lib/stripe';
import styles from '../app/billing/billing.module.css';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Everything the user has been charged, with links to the Stripe receipt/PDF. */
export function PaymentHistory({ refreshKey }: { refreshKey: string }) {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/billing/payments', { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? 'Could not load your payment history.');
        else {
          setError(null);
          setRows(body.payments ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your payment history.');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <section className={styles.card} aria-labelledby="payment-history-title">
      <h2 id="payment-history-title" className={styles.historyTitle}>
        Payment history
      </h2>
      {error && !rows && <p className={styles.note}>{error}</p>}
      {!error && rows === null && <p className={styles.note}>Loading...</p>}
      {rows && rows.length === 0 && <p className={styles.note}>No payments yet. Your invoices will appear here.</p>}
      {rows && rows.length > 0 && (
        <div className={styles.historyScroll}>
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className={styles.num}>Amount</th>
                <th>Status</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{date(row.date)}</td>
                  <td>
                    {row.description}
                    {row.number && <div className={styles.historyMeta}>Invoice {row.number}</div>}
                  </td>
                  <td className={styles.num}>{money(row.amount, row.currency)}</td>
                  <td>
                    <span className={`${styles.badge} ${row.status === 'paid' ? styles.badgeGood : styles.badgeBad}`}>
                      {row.status === 'paid' ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td className={styles.historyLinks}>
                    {row.hostedUrl && (
                      <a href={row.hostedUrl} target="_blank" rel="noopener noreferrer">
                        View
                      </a>
                    )}
                    {row.pdfUrl && (
                      <a href={row.pdfUrl} target="_blank" rel="noopener noreferrer">
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
