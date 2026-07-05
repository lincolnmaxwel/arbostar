'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './PortalActions.module.css';

type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'expired';

export function PortalActions({ token, status }: { token: string; status: QuoteStatus }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'sent') return null;

  async function respond(decision: 'approve' | 'decline') {
    setSubmitting(decision);
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error('request failed');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(null);
    }
  }

  return (
    <div className={styles.actions}>
      {error && <p className={styles.actionError}>{error}</p>}
      <button type="button" className={styles.declineButton} disabled={submitting !== null} onClick={() => respond('decline')}>
        {submitting === 'decline' ? 'Submitting...' : 'Decline'}
      </button>
      <button type="button" className={styles.approveButton} disabled={submitting !== null} onClick={() => respond('approve')}>
        {submitting === 'approve' ? 'Submitting...' : 'Approve'}
      </button>
    </div>
  );
}
