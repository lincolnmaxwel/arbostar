import { prisma } from '@/lib/db';

export type FinancialPreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export interface FinancialPeriod {
  preset: FinancialPreset;
  /** Inclusive start instant. */
  from: Date;
  /** Exclusive end instant. */
  to: Date;
  /** Human label, e.g. "Oct 1, 2026 – Oct 31, 2026". */
  label: string;
}

export interface MoneyBreakdown {
  /** Amount before GST. */
  net: number;
  /** GST collected / to collect. */
  gst: number;
  /** Net + GST. */
  gross: number;
}

export interface FinancialInvoiceRow {
  id: string;
  number: number;
  source: 'quote' | 'timesheet';
  clientName: string;
  date: string;
  paymentStatus: 'pending' | 'paid';
  net: number;
  gst: number;
  gross: number;
}

export interface FinancialSummary {
  period: { preset: FinancialPreset; from: string; to: string; label: string };
  jobs: {
    /** Invoices issued in the period (a completed job or a billed timesheet). */
    completed: number;
    completedQuotes: number;
    timesheetInvoices: number;
    paid: number;
    unpaid: number;
    /** Snapshot as of now: approved quotes scheduled but not yet completed. */
    scheduledOpen: number;
  };
  invoiced: MoneyBreakdown;
  received: MoneyBreakdown;
  outstanding: MoneyBreakdown;
  scheduledValue: MoneyBreakdown;
  invoices: FinancialInvoiceRow[];
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseDay(value: string): { y: number; m: number; d: number } | null {
  const match = DAY_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

function fmtLabel(utcMidnight: Date): string {
  return utcMidnight.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export interface PeriodInput {
  preset: FinancialPreset;
  /** Anchor day (YYYY-MM-DD) for daily/weekly/monthly/yearly. */
  date?: string;
  /** Custom range, inclusive days (YYYY-MM-DD). */
  from?: string;
  to?: string;
  /** Viewer's `Date.getTimezoneOffset()` (minutes, positive west of UTC). */
  tzOffsetMinutes?: number;
}

/**
 * Resolve a preset + anchor into a [from, to) instant range in the viewer's
 * local calendar. Weeks run Monday–Sunday.
 */
export function resolvePeriod(input: PeriodInput): FinancialPeriod | { error: string } {
  const offsetMs = (input.tzOffsetMinutes ?? 0) * 60_000;
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 18 * 3_600_000) {
    return { error: 'Invalid time zone offset.' };
  }
  const toInstant = (utcMidnightMs: number) => new Date(utcMidnightMs + offsetMs);

  let startMs: number;
  let endMsExclusive: number;

  if (input.preset === 'custom') {
    const f = input.from ? parseDay(input.from) : null;
    const t = input.to ? parseDay(input.to) : null;
    if (!f || !t) return { error: 'Choose a valid start and end date.' };
    startMs = Date.UTC(f.y, f.m - 1, f.d);
    endMsExclusive = Date.UTC(t.y, t.m - 1, t.d) + 86_400_000;
    if (endMsExclusive <= startMs) return { error: 'The end date must be on or after the start date.' };
    if (endMsExclusive - startMs > 366 * 5 * 86_400_000) return { error: 'The period cannot exceed 5 years.' };
  } else {
    const a = input.date ? parseDay(input.date) : null;
    if (!a) return { error: 'Choose a valid date.' };
    const anchor = Date.UTC(a.y, a.m - 1, a.d);
    if (input.preset === 'daily') {
      startMs = anchor;
      endMsExclusive = anchor + 86_400_000;
    } else if (input.preset === 'weekly') {
      const dow = (new Date(anchor).getUTCDay() + 6) % 7; // Monday = 0
      startMs = anchor - dow * 86_400_000;
      endMsExclusive = startMs + 7 * 86_400_000;
    } else if (input.preset === 'monthly') {
      startMs = Date.UTC(a.y, a.m - 1, 1);
      endMsExclusive = Date.UTC(a.y, a.m, 1);
    } else if (input.preset === 'yearly') {
      startMs = Date.UTC(a.y, 0, 1);
      endMsExclusive = Date.UTC(a.y + 1, 0, 1);
    } else {
      return { error: 'Unknown period.' };
    }
  }

  const first = fmtLabel(new Date(startMs));
  const last = fmtLabel(new Date(endMsExclusive - 86_400_000));
  return {
    preset: input.preset,
    from: toInstant(startMs),
    to: toInstant(endMsExclusive),
    label: first === last ? first : `${first} – ${last}`,
  };
}

function sum(rows: { net: number; gst: number; gross: number }[]): MoneyBreakdown {
  return {
    net: round2(rows.reduce((s, r) => s + r.net, 0)),
    gst: round2(rows.reduce((s, r) => s + r.gst, 0)),
    gross: round2(rows.reduce((s, r) => s + r.gross, 0)),
  };
}

/**
 * Financial rollup for one data owner. Everything money-related is based on
 * invoices issued (createdAt) inside the period, split by payment status;
 * "scheduled" is a live snapshot of approved quotes not yet completed.
 */
export async function getFinancialSummary(userId: string, period: FinancialPeriod): Promise<FinancialSummary> {
  const [invoices, scheduled] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, createdAt: { gte: period.from, lt: period.to } },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.quote.findMany({
      where: { createdById: userId, status: 'scheduled' },
      select: { subtotal: true, taxAmount: true, total: true },
    }),
  ]);

  const rows: FinancialInvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    source: inv.source,
    clientName: inv.client.name,
    date: inv.createdAt.toISOString(),
    paymentStatus: inv.paymentStatus,
    net: Number(inv.subtotal),
    gst: Number(inv.taxAmount),
    gross: Number(inv.total),
  }));

  const paid = rows.filter((r) => r.paymentStatus === 'paid');
  const unpaid = rows.filter((r) => r.paymentStatus !== 'paid');

  return {
    period: { preset: period.preset, from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
    jobs: {
      completed: rows.length,
      completedQuotes: rows.filter((r) => r.source === 'quote').length,
      timesheetInvoices: rows.filter((r) => r.source === 'timesheet').length,
      paid: paid.length,
      unpaid: unpaid.length,
      scheduledOpen: scheduled.length,
    },
    invoiced: sum(rows),
    received: sum(paid),
    outstanding: sum(unpaid),
    scheduledValue: sum(
      scheduled.map((q) => ({ net: Number(q.subtotal), gst: Number(q.taxAmount), gross: Number(q.total) })),
    ),
    invoices: rows,
  };
}

const PRESETS: FinancialPreset[] = ['daily', 'weekly', 'monthly', 'yearly', 'custom'];

/** Parse `preset`, `date`, `from`, `to`, `tz` query params into a period. */
export function periodFromSearchParams(sp: URLSearchParams): FinancialPeriod | { error: string } {
  const preset = (sp.get('preset') ?? 'monthly') as FinancialPreset;
  if (!PRESETS.includes(preset)) return { error: 'Unknown period.' };
  const tzRaw = sp.get('tz');
  return resolvePeriod({
    preset,
    date: sp.get('date') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    tzOffsetMinutes: tzRaw === null ? 0 : Number(tzRaw),
  });
}
