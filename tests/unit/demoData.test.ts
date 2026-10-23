import { describe, expect, it } from 'vitest';
import {
  addDays,
  entryHours,
  entrySubtotal,
  invoiceFromQuote,
  invoicesFromEntries,
  quoteTotals,
  resolveDemoPeriod,
  seedDemoData,
  summarizeDemo,
} from '@/lib/demoData';

const TODAY = '2026-10-23';

describe('demo data', () => {
  it('computes quote totals with 5% GST', () => {
    expect(quoteTotals([{ price: 1200 }, { price: 280 }, { price: 150 }])).toEqual({ subtotal: 1630, tax: 81.5, total: 1711.5 });
  });

  it('seeds every status the demo walks through and consistent invoices', () => {
    const data = seedDemoData(TODAY);
    const statuses = new Set(data.quotes.map((q) => q.status));
    for (const s of ['draft', 'sent', 'approved', 'scheduled', 'completed', 'declined']) expect(statuses).toContain(s);
    for (const inv of data.invoices) {
      expect(inv.total).toBeCloseTo(inv.subtotal + inv.tax, 2);
      expect(inv.subtotal).toBeCloseTo(inv.lines.reduce((s, l) => s + l.amount, 0), 2);
    }
    // invoiced timesheet entries match the seeded timesheet invoice
    const invoiced = data.entries.filter((e) => e.status === 'invoiced').reduce((s, e) => s + entrySubtotal(e), 0);
    expect(invoiced).toBe(data.invoices.find((i) => i.source === 'timesheet')!.subtotal);
  });

  it('numbers new invoices after the existing ones', () => {
    const data = seedDemoData(TODAY);
    const inv = invoiceFromQuote(data.quotes[3], data.invoices, TODAY);
    expect(inv.number).toBe(5);
    expect(inv.paymentStatus).toBe('pending');
    expect(inv.total).toBe(quoteTotals(data.quotes[3].items).total);
  });

  it('creates one invoice per client from timesheet entries', () => {
    const data = seedDemoData(TODAY);
    const open = data.entries.filter((e) => e.status === 'open');
    const created = invoicesFromEntries(open, data.clients, data.invoices, TODAY);
    expect(created).toHaveLength(new Set(open.map((e) => e.clientId)).size);
    expect(created.map((i) => i.number)).toEqual(created.map((_, i) => 5 + i));
  });

  it('ignores zero or negative durations', () => {
    expect(entryHours({ startTime: '09:00', endTime: '08:00' })).toBe(0);
    expect(entryHours({ startTime: '08:00', endTime: '16:30' })).toBe(8.5);
  });

  it('resolves periods and summarizes invoices inside them', () => {
    const data = seedDemoData(TODAY);
    expect(resolveDemoPeriod('weekly', TODAY, '', '')).toMatchObject({ from: '2026-10-19', to: '2026-10-25' });
    expect(resolveDemoPeriod('monthly', TODAY, '', '')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    const year = resolveDemoPeriod('yearly', TODAY, '', '');
    const all = summarizeDemo(data, year.from, year.to);
    expect(all.jobs.completed).toBe(data.invoices.length);
    expect(all.jobs.paid + all.jobs.unpaid).toBe(all.jobs.completed);
    expect(all.received.gross + all.outstanding.gross).toBeCloseTo(all.invoiced.gross, 2);
    const none = summarizeDemo(data, addDays(TODAY, 1), addDays(TODAY, 2));
    expect(none.invoices).toHaveLength(0);
  });
});
