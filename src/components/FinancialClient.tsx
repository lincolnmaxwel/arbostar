'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatMoney } from '@/lib/quoteMath';
import type { FinancialPreset, FinancialSummary, MoneyBreakdown } from '@/lib/financial';
import styles from '@/app/financial/financial.module.css';

const PRESETS: { key: FinancialPreset; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'custom', label: 'Custom' },
];

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function MoneyCard({ title, hint, data, tone }: { title: string; hint: string; data: MoneyBreakdown; tone?: 'paid' | 'pending' }) {
  return (
    <div className={`${styles.moneyCard} ${tone === 'paid' ? styles.tonePaid : tone === 'pending' ? styles.tonePending : ''}`}>
      <div className={styles.moneyTitle}>{title}</div>
      <div className={styles.moneyHint}>{hint}</div>
      <div className={styles.moneyTotal}>{formatMoney(data.gross)}</div>
      <div className={styles.moneyLine}>
        <span>Net (before GST)</span>
        <strong>{formatMoney(data.net)}</strong>
      </div>
      <div className={styles.moneyLine}>
        <span>GST</span>
        <strong>{formatMoney(data.gst)}</strong>
      </div>
    </div>
  );
}

export function FinancialClient() {
  const [preset, setPreset] = useState<FinancialPreset>('monthly');
  const [date, setDate] = useState(todayLocal);
  const [from, setFrom] = useState(todayLocal);
  const [to, setTo] = useState(todayLocal);
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const qs = new URLSearchParams({ preset, tz: String(new Date().getTimezoneOffset()) });
    if (preset === 'custom') {
      qs.set('from', from);
      qs.set('to', to);
    } else {
      qs.set('date', date);
    }
    return qs.toString();
  }, [preset, date, from, to]);

  const rangeMissing = preset === 'custom' ? !from || !to : !date;
  const rangeReversed = preset === 'custom' && !!from && !!to && to < from;
  const inputInvalid = rangeMissing || rangeReversed;

  useEffect(() => {
    if (inputInvalid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/financial?${query}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? 'Could not load the financial summary.');
        return body as FinancialSummary;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, inputInvalid]);

  const shownError = rangeReversed ? 'The end date must be on or after the start date.' : error;
  const canExport = !inputInvalid && !error && !!data;

  return (
    <div>
      <div className={styles.filters} data-tour="page-financial">
        <div className={styles.presetTabs} role="tablist" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={preset === p.key}
              className={`${styles.presetTab} ${preset === p.key ? styles.presetTabActive : ''}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.dateRow}>
          {preset === 'custom' ? (
            <>
              <label className={styles.dateField}>
                <span>From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className={styles.dateField}>
                <span>To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          ) : (
            <label className={styles.dateField}>
              <span>
                {preset === 'daily' && 'Day'}
                {preset === 'weekly' && 'Any day in the week'}
                {preset === 'monthly' && 'Any day in the month'}
                {preset === 'yearly' && 'Any day in the year'}
              </span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {canExport ? (
            <a href={`/api/financial/pdf?${query}`} download className={styles.pdfButton}>
              Download PDF report
            </a>
          ) : (
            <span className={`${styles.pdfButton} ${styles.pdfButtonDisabled}`} aria-disabled="true">
              Download PDF report
            </span>
          )}
        </div>
      </div>

      {shownError && (
        <p className={styles.error} role="alert">
          {shownError}
        </p>
      )}

      {data && !shownError && (
        <div className={loading ? styles.loading : undefined}>
          <p className={styles.periodLabel}>{data.period.label}</p>

          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{data.jobs.completed}</div>
              <div className={styles.kpiLabel}>Jobs completed</div>
              <div className={styles.kpiSub}>
                {data.jobs.completedQuotes} from quotes · {data.jobs.timesheetInvoices} from timesheets
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{data.jobs.paid}</div>
              <div className={styles.kpiLabel}>Paid</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{data.jobs.unpaid}</div>
              <div className={styles.kpiLabel}>Awaiting payment</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{data.jobs.scheduledOpen}</div>
              <div className={styles.kpiLabel}>Scheduled (open)</div>
              <div className={styles.kpiSub}>Approved, not yet completed (current)</div>
            </div>
          </div>

          <div className={styles.moneyGrid}>
            <MoneyCard title="Invoiced" hint="Issued in this period" data={data.invoiced} />
            <MoneyCard title="Received" hint="Paid invoices" data={data.received} tone="paid" />
            <MoneyCard title="Outstanding" hint="Awaiting payment" data={data.outstanding} tone="pending" />
            <MoneyCard title="Scheduled work" hint="Open jobs, expected value" data={data.scheduledValue} />
          </div>

          <h2 className={styles.sectionTitle}>Invoices in this period</h2>
          {data.invoices.length === 0 ? (
            <p className={styles.empty}>No invoices were issued in this period.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th className={styles.num}>Net</th>
                    <th className={styles.num}>GST</th>
                    <th className={styles.num}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <Link href={`/invoices/${inv.id}`} className={styles.link}>
                          #{inv.number}
                        </Link>
                      </td>
                      <td>{new Date(inv.date).toLocaleDateString()}</td>
                      <td>{inv.clientName}</td>
                      <td>
                        <span className={inv.paymentStatus === 'paid' ? styles.badgePaid : styles.badgePending}>
                          {inv.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                        </span>
                      </td>
                      <td className={styles.num}>{formatMoney(inv.net)}</td>
                      <td className={styles.num}>{formatMoney(inv.gst)}</td>
                      <td className={styles.num}>{formatMoney(inv.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {!data && !shownError && <p className={styles.empty}>Loading...</p>}
    </div>
  );
}
