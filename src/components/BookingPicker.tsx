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

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
  const [suggestedDate, setSuggestedDate] = useState('');
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
    if (!suggestedDate) return;
    setSubmitting('reject');
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/booking/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The reason field is a free-text string server-side — sending the
        // formatted date through it keeps the API/schema unchanged while
        // staff still see a clear, readable suggestion instead of a raw
        // ISO string in the notification email and quote view.
        body: JSON.stringify({ decision: 'reject', reason: `Suggested: ${formatDate(suggestedDate)}` }),
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
          <label className={styles.reasonLabel} htmlFor="suggested-date">
            What date works for you?
          </label>
          <input
            id="suggested-date"
            type="date"
            className={styles.reasonInput}
            value={suggestedDate}
            onChange={(e) => setSuggestedDate(e.target.value)}
            aria-label="Suggested date"
            min={todayIso()}
          />
          <button
            type="button"
            className={styles.submitReason}
            onClick={reject}
            disabled={!suggestedDate || submiting !== null}
          >
            {submiting === 'reject' ? 'Submitting…' : 'Submit'}
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
            Suggested date
          </button>
        </div>
      )}
    </div>
  );
}
