'use client';

import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/quoteMath';
import { formatDay, resolveDemoPeriod, summarizeDemo, type DemoPreset } from '@/lib/demoData';
import styles from '@/app/financial/financial.module.css';
import type { DemoScreenProps } from './demoTypes';

const PRESETS: { key: DemoPreset; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'custom', label: 'Custom' },
];

function MoneyCard({ title, hint, data, tone }: { title: string; hint: string; data: { net: number; gst: number; gross: number }; tone?: 'paid' | 'pending' }) {
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

export function DemoFinancial({ data, today, go, toast }: DemoScreenProps) {
  // Yearly by default so the sample invoices (spread over a few months) show up right away.
  const [preset, setPreset] = useState<DemoPreset>('yearly');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const reversed = preset === 'custom' && !!from && !!to && to < from;
  const period = useMemo(() => resolveDemoPeriod(preset, date, from, to), [preset, date, from, to]);
  const summary = useMemo(() => summarizeDemo(data, period.from, period.to), [data, period]);

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Financial</h1>
      </div>

      <div className={styles.filters}>
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
          <button
            type="button"
            className={styles.pdfButton}
            onClick={() => toast('In the real app this downloads a PDF report of the period for your accountant.')}
          >
            Download PDF report
          </button>
        </div>
      </div>

      {reversed ? (
        <p className={styles.error} role="alert">
          The end date must be on or after the start date.
        </p>
      ) : (
        <div>
          <p className={styles.periodLabel}>{period.label}</p>

          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{summary.jobs.completed}</div>
              <div className={styles.kpiLabel}>Jobs completed</div>
              <div className={styles.kpiSub}>
                {summary.jobs.completedQuotes} from quotes · {summary.jobs.timesheetInvoices} from timesheets
              </div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{summary.jobs.paid}</div>
              <div className={styles.kpiLabel}>Paid</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{summary.jobs.unpaid}</div>
              <div className={styles.kpiLabel}>Awaiting payment</div>
            </div>
            <div className={styles.kpi}>
              <div className={styles.kpiValue}>{summary.jobs.scheduledOpen}</div>
              <div className={styles.kpiLabel}>Scheduled (open)</div>
              <div className={styles.kpiSub}>Approved, not yet completed (current)</div>
            </div>
          </div>

          <div className={styles.moneyGrid}>
            <MoneyCard title="Invoiced" hint="Issued in this period" data={summary.invoiced} />
            <MoneyCard title="Received" hint="Paid invoices" data={summary.received} tone="paid" />
            <MoneyCard title="Outstanding" hint="Awaiting payment" data={summary.outstanding} tone="pending" />
            <MoneyCard title="Scheduled work" hint="Open jobs, expected value" data={summary.scheduledValue} />
          </div>

          <h2 className={styles.sectionTitle}>Invoices in this period</h2>
          {summary.invoices.length === 0 ? (
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
                  {summary.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <button type="button" className={styles.link} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => go('invoices', inv.id)}>
                          #{inv.number}
                        </button>
                      </td>
                      <td>{formatDay(inv.date)}</td>
                      <td>{inv.clientName}</td>
                      <td>
                        <span className={inv.paymentStatus === 'paid' ? styles.badgePaid : styles.badgePending}>{inv.paymentStatus === 'paid' ? 'Paid' : 'Pending'}</span>
                      </td>
                      <td className={styles.num}>{formatMoney(inv.subtotal)}</td>
                      <td className={styles.num}>{formatMoney(inv.tax)}</td>
                      <td className={styles.num}>{formatMoney(inv.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
