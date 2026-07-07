'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './BookingForm.module.css';

type DayWindow = 'morning' | 'afternoon' | 'fullday';
type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';

interface BookingOption {
  id: string;
  proposedDate: string;
  window: DayWindow;
  chosen: boolean;
}

interface BookingState {
  quote: {
    id: string;
    status: string;
    bookingStatus: BookingStatus;
    scheduledDate?: string | null;
    scheduledWindow?: DayWindow | null;
  };
  latestRound: {
    id: string;
    roundNumber: number;
    status: string;
    rejectionReason: string | null;
    proposedAt: string;
    respondedAt: string | null;
    options: BookingOption[];
  } | null;
}

interface Row {
  date: string;
  window: DayWindow;
}

const WINDOW_LABELS: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function BookingForm({ serverId, draftId }: { serverId: string; draftId: string }) {
  const router = useRouter();
  const [state, setState] = useState<BookingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([{ date: '', window: 'morning' }]);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Polls every 5s rather than fetching once — the client can confirm or
    // reject a proposed round at any time while staff is sitting on this
    // page, and that only reaches this tab through polling, not a fetch
    // that ran once on mount.
    function loadState() {
      fetch(`/api/quotes/${serverId}/booking`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: BookingState | null) => {
          if (!cancelled && body) setState(body);
          else if (!cancelled) setLoadError('Could not load booking state.');
        })
        .catch(() => {
          if (!cancelled) setLoadError('Could not load booking state.');
        });
    }

    loadState();
    const timer = setInterval(loadState, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [serverId]);

  function addRow() {
    if (rows.length >= 3) return;
    setRows([...rows, { date: '', window: 'morning' }]);
  }

  function removeRow(index: number) {
    if (rows.length === 1) return;
    setRows(rows.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const filledRows = rows.filter((r) => r.date && r.window);
  const canSubmit = filledRows.length >= 1 && !submitting;

  function validate(): string | null {
    const today = todayStr();
    for (const r of filledRows) {
      if (r.date < today) return 'Past date not allowed.';
    }
    const seen = new Set<string>();
    for (const r of filledRows) {
      const key = `${r.date}|${r.window}`;
      if (seen.has(key)) return 'Duplicate date+window not allowed.';
      seen.add(key);
    }
    return null;
  }

  async function submit() {
    setValidationError(null);
    setSubmitError(null);
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/quotes/${serverId}/booking/round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: filledRows }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'round-already-active') {
          setSubmitError('Round already active — a booking round is awaiting client response.');
        } else if (body.error === 'already-scheduled') {
          setSubmitError('This quote has already been scheduled.');
        } else {
          setSubmitError('Cannot create a new round right now.');
        }
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setSubmitError('Could not submit. Please try again.');
        setSubmitting(false);
        return;
      }
      router.refresh();
      router.push(`/quotes/${draftId}`);
    } catch {
      setSubmitError('Network error — please try again.');
      setSubmitting(false);
    }
  }

  if (loadError) return <p className={styles.banner}>{loadError}</p>;
  if (!state) return <p>Loading…</p>;

  const { quote, latestRound } = state;
  const rejectedRound = latestRound && latestRound.status === 'rejected' ? latestRound : null;

  return (
    <div className={styles.form}>
      <p className={styles.state}>Current status: {quote.bookingStatus}</p>

      {rejectedRound?.rejectionReason && (
        <div className={styles.rejection}>
          <p className={styles.rejectionLabel}>Client rejected round {rejectedRound.roundNumber}</p>
          <p className={styles.rejectionReason}>"{rejectedRound.rejectionReason}"</p>
        </div>
      )}

      {validationError && <div className={`${styles.banner} ${styles.errorBanner}`}>{validationError}</div>}
      {submitError && <div className={`${styles.banner} ${styles.errorBanner}`}>{submitError}</div>}

      {rows.map((row, i) => (
        <div key={i} className={styles.row}>
          <input
            type="date"
            aria-label={`Date ${i + 1}`}
            value={row.date}
            min={todayStr()}
            onChange={(e) => updateRow(i, { date: e.target.value })}
          />
          <select
            aria-label={`Window ${i + 1}`}
            value={row.window}
            onChange={(e) => updateRow(i, { window: e.target.value as DayWindow })}
          >
            <option value="morning">{WINDOW_LABELS.morning}</option>
            <option value="afternoon">{WINDOW_LABELS.afternoon}</option>
            <option value="fullday">{WINDOW_LABELS.fullday}</option>
          </select>
          <button type="button" className={styles.removeRow} onClick={() => removeRow(i)} aria-label={`Remove row ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}

      <button type="button" className={styles.addRow} onClick={addRow} disabled={rows.length >= 3}>
        Add date
      </button>

      <button type="button" className={styles.submit} onClick={submit} disabled={!canSubmit}>
        {submitting ? 'Sending…' : 'Send to client'}
      </button>
    </div>
  );
}
