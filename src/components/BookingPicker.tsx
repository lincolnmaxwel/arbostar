'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './BookingPicker.module.css';

type DayWindow = 'morning' | 'afternoon' | 'fullday';

export interface BookingPickerOption {
  id: string;
  proposedDate: string;
  window: DayWindow;
  chosen: boolean;
}

const WINDOW_LABELS: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function BookingPicker({
  token,
  roundId,
  options,
}: {
  token: string;
  roundId: string;
  options: BookingPickerOption[];
}) {
  const router = useRouter();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [submiting, setSubmitting] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selectedOptionId) return;
    setSubmitting('confirm');
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/booking/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'confirm', optionId: selectedOptionId }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(null);
    }
  }

  async function reject() {
    setSubmitting('reject');
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/booking/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', reason }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(null);
    }
  }

  return (
    <div className={styles.picker}>
      <p>Pick the date that works for you:</p>
      <div className={styles.options} role="radiogroup" aria-label="Date options">
        {options.map((opt) => (
          <label key={opt.id} className={styles.optionLabel}>
            <input
              type="radio"
              name="date-option"
              value={opt.id}
              className={styles.optionInput}
              checked={selectedOptionId === opt.id}
              onChange={() => setSelectedOptionId(opt.id)}
              aria-label={formatDate(opt.proposedDate)}
            />
            <span className={styles.optionDate}>{formatDate(opt.proposedDate)}</span>
            <div className={styles.optionWindow}>{WINDOW_LABELS[opt.window]}</div>
          </label>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {rejecting ? (
        <div className={styles.rejectBox}>
          <label className={styles.reasonLabel} htmlFor="reject-reason">
            Reason
          </label>
          <textarea
            id="reject-reason"
            className={styles.reasonInput}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason"
            placeholder="Tell us why these dates don't work."
          />
          <button
            type="button"
            className={styles.submitReason}
            onClick={reject}
            disabled={reason.trim().length < 3 || submiting !== null}
          >
            {submiting === 'reject' ? 'Submitting…' : 'Submit reason'}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.confirm}
            onClick={confirm}
            disabled={!selectedOptionId || submiting !== null}
          >
            {submiting === 'confirm' ? 'Submitting…' : 'Confirm date'}
          </button>
          <button
            type="button"
            className={styles.reject}
            onClick={() => setRejecting(true)}
            disabled={submiting !== null}
          >
            Reject all
          </button>
        </div>
      )}
    </div>
  );
}
