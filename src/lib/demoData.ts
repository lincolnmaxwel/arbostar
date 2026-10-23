// Sample data and pure helpers for the public /demo. Nothing here touches the
// database or the network: the demo keeps everything in React state, so a
// reload (or "Reset demo") brings back exactly this data.

import type { ApprovalStatus, BookingStatus } from '@/lib/quoteStatusLabel';
import type { InvoicePaymentStatus } from '@/lib/paymentStatusLabel';

export const DEMO_GST_RATE = 0.05;
export const DEMO_HOURLY_RATE = 65;

export interface DemoClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface DemoQuoteItem {
  id: string;
  title: string;
  description: string;
  price: number;
}

export interface DemoQuote {
  id: string;
  number: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  serviceAddress: string;
  items: DemoQuoteItem[];
  status: ApprovalStatus;
  booking: BookingStatus;
  scheduledDate: string | null; // YYYY-MM-DD
  scheduledWindow: 'morning' | 'afternoon' | null;
  updatedAt: string; // YYYY-MM-DD
}

export interface DemoService {
  id: string;
  name: string;
  billingType: 'quantity' | 'hourly';
  unit: string;
  defaultPrice: number;
}

export interface DemoProduct {
  id: string;
  name: string;
  billingType: 'quantity' | 'hourly';
  unit: string;
  quantity: number;
  unitPrice: number;
}

export interface DemoEntry {
  id: string;
  workDate: string; // YYYY-MM-DD
  clientId: string;
  description: string;
  startTime: string; // HH:MM
  endTime: string;
  hourlyRate: number;
  products: DemoProduct[];
  status: 'open' | 'invoiced';
}

export interface DemoInvoiceLine {
  title: string;
  description: string;
  amount: number;
}

export interface DemoInvoice {
  id: string;
  number: number;
  source: 'quote' | 'timesheet';
  quoteNumber: number | null;
  clientName: string;
  clientEmail: string;
  date: string; // YYYY-MM-DD
  lines: DemoInvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  paymentStatus: InvoicePaymentStatus;
}

export interface DemoData {
  clients: DemoClient[];
  quotes: DemoQuote[];
  services: DemoService[];
  entries: DemoEntry[];
  invoices: DemoInvoice[];
}

export function uid(): string {
  return `d${Math.random().toString(36).slice(2, 10)}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- dates (all local, YYYY-MM-DD strings so there is no timezone drift) ----

export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDay(iso: string): string {
  const d = parseDay(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ---- money ----

export function quoteTotals(items: { price: number }[]) {
  const subtotal = round2(items.reduce((sum, item) => sum + item.price, 0));
  const tax = round2(subtotal * DEMO_GST_RATE);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

export function entryHours(entry: Pick<DemoEntry, 'startTime' | 'endTime'>): number {
  const [sh, sm] = entry.startTime.split(':').map(Number);
  const [eh, em] = entry.endTime.split(':').map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return minutes > 0 ? minutes / 60 : 0;
}

export function entryLabor(entry: DemoEntry): number {
  return round2(entryHours(entry) * entry.hourlyRate);
}

export function entryProductsTotal(entry: DemoEntry): number {
  return round2(entry.products.reduce((sum, p) => sum + p.quantity * p.unitPrice, 0));
}

export function entrySubtotal(entry: DemoEntry): number {
  return round2(entryLabor(entry) + entryProductsTotal(entry));
}

export function nextInvoiceNumber(invoices: DemoInvoice[]): number {
  return invoices.reduce((max, inv) => Math.max(max, inv.number), 0) + 1;
}

export function nextQuoteNumber(quotes: DemoQuote[]): number {
  return quotes.reduce((max, q) => Math.max(max, q.number), 0) + 1;
}

/** Invoice for a completed quote: a snapshot of its lines and totals. */
export function invoiceFromQuote(quote: DemoQuote, invoices: DemoInvoice[], today: string): DemoInvoice {
  const { subtotal, tax, total } = quoteTotals(quote.items);
  const client = quote.clientEmail;
  return {
    id: uid(),
    number: nextInvoiceNumber(invoices),
    source: 'quote',
    quoteNumber: quote.number,
    clientName: quote.clientName,
    clientEmail: client,
    date: today,
    lines: quote.items.map((i) => ({ title: i.title, description: i.description, amount: i.price })),
    subtotal,
    tax,
    total,
    paymentStatus: 'pending',
  };
}

/** One invoice per client for the selected open timesheet entries. */
export function invoicesFromEntries(
  entries: DemoEntry[],
  clients: DemoClient[],
  invoices: DemoInvoice[],
  today: string,
): DemoInvoice[] {
  const byClient = new Map<string, DemoEntry[]>();
  for (const e of entries) byClient.set(e.clientId, [...(byClient.get(e.clientId) ?? []), e]);
  const created: DemoInvoice[] = [];
  let number = nextInvoiceNumber(invoices);
  for (const [clientId, list] of byClient) {
    const client = clients.find((c) => c.id === clientId);
    const lines: DemoInvoiceLine[] = list.map((e) => ({
      title: `Labor - ${formatDay(e.workDate)}`,
      description: `${e.description} (${entryHours(e).toFixed(2)} h at $${e.hourlyRate.toFixed(2)}/h)${
        e.products.length ? `; ${e.products.map((p) => `${p.name} x ${p.quantity}`).join(', ')}` : ''
      }`,
      amount: entrySubtotal(e),
    }));
    const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
    const tax = round2(subtotal * DEMO_GST_RATE);
    created.push({
      id: uid(),
      number: number++,
      source: 'timesheet',
      quoteNumber: null,
      clientName: client?.name ?? 'Client',
      clientEmail: client?.email ?? '',
      date: today,
      lines,
      subtotal,
      tax,
      total: round2(subtotal + tax),
      paymentStatus: 'pending',
    });
  }
  return created;
}

// ---- financial report ----

export type DemoPreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export function resolveDemoPeriod(preset: DemoPreset, anchor: string, from: string, to: string) {
  const a = parseDay(anchor);
  if (preset === 'custom') {
    return { from, to, label: `${formatDay(from)} - ${formatDay(to)}` };
  }
  if (preset === 'daily') return { from: anchor, to: anchor, label: formatDay(anchor) };
  if (preset === 'weekly') {
    const mondayOffset = (a.getDay() + 6) % 7;
    const start = addDays(anchor, -mondayOffset);
    const end = addDays(start, 6);
    return { from: start, to: end, label: `Week of ${formatDay(start)} - ${formatDay(end)}` };
  }
  if (preset === 'monthly') {
    const start = isoDay(new Date(a.getFullYear(), a.getMonth(), 1));
    const end = isoDay(new Date(a.getFullYear(), a.getMonth() + 1, 0));
    return { from: start, to: end, label: `${MONTHS[a.getMonth()]} ${a.getFullYear()}` };
  }
  return { from: `${a.getFullYear()}-01-01`, to: `${a.getFullYear()}-12-31`, label: String(a.getFullYear()) };
}

interface MoneySplit {
  net: number;
  gst: number;
  gross: number;
}

function split(invoices: DemoInvoice[]): MoneySplit {
  return {
    net: round2(invoices.reduce((s, i) => s + i.subtotal, 0)),
    gst: round2(invoices.reduce((s, i) => s + i.tax, 0)),
    gross: round2(invoices.reduce((s, i) => s + i.total, 0)),
  };
}

export function summarizeDemo(data: DemoData, from: string, to: string) {
  const inPeriod = data.invoices
    .filter((i) => i.date >= from && i.date <= to)
    .sort((a, b) => (a.date === b.date ? b.number - a.number : a.date < b.date ? 1 : -1));
  const paid = inPeriod.filter((i) => i.paymentStatus === 'paid');
  const unpaid = inPeriod.filter((i) => i.paymentStatus !== 'paid');
  const scheduled = data.quotes.filter((q) => q.status === 'scheduled');
  return {
    jobs: {
      completed: inPeriod.length,
      completedQuotes: inPeriod.filter((i) => i.source === 'quote').length,
      timesheetInvoices: inPeriod.filter((i) => i.source === 'timesheet').length,
      paid: paid.length,
      unpaid: unpaid.length,
      scheduledOpen: scheduled.length,
    },
    invoiced: split(inPeriod),
    received: split(paid),
    outstanding: split(unpaid),
    scheduledValue: split(
      scheduled.map((q) => {
        const t = quoteTotals(q.items);
        return { subtotal: t.subtotal, tax: t.tax, total: t.total } as DemoInvoice;
      }),
    ),
    invoices: inPeriod,
  };
}

// ---- seed ----

function item(title: string, description: string, price: number): DemoQuoteItem {
  return { id: uid(), title, description, price };
}

export function seedDemoData(today: string): DemoData {
  const day = (offset: number) => addDays(today, offset);

  const clients: DemoClient[] = [
    { id: 'c-margaret', name: 'Margaret Chen', email: 'margaret.chen@example.com', phone: '(604) 555-0142', address: '1450 Maple Ridge Dr, Burnaby, BC' },
    { id: 'c-greenview', name: 'Greenview Strata', email: 'office@greenview-strata.example.com', phone: '(604) 555-0177', address: '300 Greenview Way, Coquitlam, BC' },
    { id: 'c-daniel', name: 'Daniel Okafor', email: 'daniel.okafor@example.com', phone: '(778) 555-0120', address: '88 Birchwood Cres, Surrey, BC' },
    { id: 'c-priya', name: 'Priya Nair', email: 'priya.nair@example.com', phone: '(604) 555-0163', address: '2210 Cedar Hill Rd, Delta, BC' },
    { id: 'c-tom', name: 'Tom Harrison', email: 'tom.harrison@example.com', phone: '(778) 555-0189', address: '47 Lakeview Terrace, Langley, BC' },
    { id: 'c-elena', name: 'Elena Rossi', email: 'elena.rossi@example.com', phone: '(604) 555-0108', address: '915 Fir Street, New Westminster, BC' },
  ];

  const byName = (name: string) => clients.find((c) => c.name === name)!;
  const quote = (
    number: number,
    clientName: string,
    items: DemoQuoteItem[],
    status: ApprovalStatus,
    updatedOffset: number,
    extra: Partial<DemoQuote> = {},
  ): DemoQuote => {
    const c = byName(clientName);
    return {
      id: `q-${number}`,
      number,
      clientName,
      clientEmail: c.email,
      clientPhone: c.phone,
      serviceAddress: c.address,
      items,
      status,
      booking: 'idle',
      scheduledDate: null,
      scheduledWindow: null,
      updatedAt: day(updatedOffset),
      ...extra,
    };
  };

  const quotes: DemoQuote[] = [
    quote(1, 'Margaret Chen', [item('Remove 60 ft Douglas fir', 'Fell in sections over the fence, haul away all wood and brush.', 1450), item('Grind stump', 'Grind 12 in below grade and backfill with chips.', 280)], 'completed', -75),
    quote(2, 'Greenview Strata', [item('Crown pruning - 14 maples', 'Remove deadwood and lift canopy over the walkways.', 2100), item('Hedge trimming', 'Shape the 200 ft cedar hedge along the entrance.', 640)], 'completed', -40),
    quote(3, 'Daniel Okafor', [item('Storm damage cleanup', 'Cut and clear two fallen limbs from the roof and yard.', 890)], 'completed', -2),
    quote(4, 'Priya Nair', [item('Remove two dead cedars', 'Back-yard removal with crane assist, includes cleanup.', 3200), item('Wood chip delivery', 'One load of fresh chips to the front driveway.', 85)], 'scheduled', -3, {
      booking: 'confirmed',
      scheduledDate: day(4),
      scheduledWindow: 'morning',
    }),
    quote(5, 'Tom Harrison', [item('Cabling and bracing - oak', 'Install two dynamic cables to reduce split risk.', 760), item('Light pruning', 'Clear 4 limbs touching the roofline.', 340)], 'approved', -1),
    quote(6, 'Elena Rossi', [item('Hedge trimming', 'Front and side privacy hedge, haul debris.', 420), item('Wood chip delivery', 'Two loads for the garden beds.', 170)], 'sent', 0),
    quote(7, 'Margaret Chen', [item('Grind stump', 'Front yard maple stump, 18 in.', 240)], 'draft', 0),
    quote(8, 'Tom Harrison', [item('Remove laurel hedge', 'Full removal and stump grinding along the back fence.', 1900)], 'declined', -30),
  ];

  const services: DemoService[] = [
    { id: 's-removal', name: 'Tree removal', billingType: 'quantity', unit: 'each', defaultPrice: 650 },
    { id: 's-crown', name: 'Crown pruning', billingType: 'hourly', unit: '', defaultPrice: 95 },
    { id: 's-stump', name: 'Stump grinding', billingType: 'quantity', unit: 'stump', defaultPrice: 180 },
    { id: 's-hedge', name: 'Hedge trimming', billingType: 'hourly', unit: '', defaultPrice: 70 },
    { id: 's-chips', name: 'Wood chip delivery', billingType: 'quantity', unit: 'load', defaultPrice: 85 },
    { id: 's-storm', name: 'Emergency storm call-out', billingType: 'quantity', unit: 'each', defaultPrice: 250 },
  ];

  const entry = (
    id: string,
    offset: number,
    clientId: string,
    description: string,
    startTime: string,
    endTime: string,
    products: DemoProduct[],
    status: DemoEntry['status'],
  ): DemoEntry => ({ id, workDate: day(offset), clientId, description, startTime, endTime, hourlyRate: DEMO_HOURLY_RATE, products, status });

  const chips = (qty: number): DemoProduct => ({ id: uid(), name: 'Wood chip delivery', billingType: 'quantity', unit: 'load', quantity: qty, unitPrice: 85 });

  const entries: DemoEntry[] = [
    entry('e-1', -14, 'c-greenview', 'Spring clean-up of the common areas.', '08:00', '16:00', [chips(1)], 'invoiced'),
    entry('e-2', -13, 'c-greenview', 'Trimmed shrubs along the parking lot.', '08:00', '12:00', [], 'invoiced'),
    entry('e-3', -3, 'c-elena', 'Pruned the apple trees and cleared the lot line.', '08:00', '15:30', [chips(2)], 'open'),
    entry('e-4', -2, 'c-tom', 'Removed storm-damaged branches.', '09:00', '13:00', [], 'open'),
    entry('e-5', -1, 'c-elena', 'Hedge shaping and debris haul.', '08:00', '17:00', [], 'open'),
    entry('e-6', 0, 'c-daniel', 'Follow-up cleanup after the storm job.', '08:00', '11:30', [], 'open'),
  ];

  const mkInvoice = (
    number: number,
    source: DemoInvoice['source'],
    quoteNumber: number | null,
    clientName: string,
    offset: number,
    lines: DemoInvoiceLine[],
    paymentStatus: InvoicePaymentStatus,
  ): DemoInvoice => {
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const tax = round2(subtotal * DEMO_GST_RATE);
    return {
      id: `i-${number}`,
      number,
      source,
      quoteNumber,
      clientName,
      clientEmail: byName(clientName).email,
      date: day(offset),
      lines,
      subtotal,
      tax,
      total: round2(subtotal + tax),
      paymentStatus,
    };
  };

  const fromQuote = (q: DemoQuote) => q.items.map((i) => ({ title: i.title, description: i.description, amount: i.price }));

  const invoices: DemoInvoice[] = [
    mkInvoice(1, 'quote', 1, 'Margaret Chen', -75, fromQuote(quotes[0]), 'paid'),
    mkInvoice(2, 'quote', 2, 'Greenview Strata', -40, fromQuote(quotes[1]), 'paid'),
    mkInvoice(3, 'timesheet', null, 'Greenview Strata', -12, [
      { title: `Labor - ${formatDay(day(-14))}`, description: 'Spring clean-up of the common areas. (8.00 h at $65.00/h); Wood chip delivery x 1', amount: 605 },
      { title: `Labor - ${formatDay(day(-13))}`, description: 'Trimmed shrubs along the parking lot. (4.00 h at $65.00/h)', amount: 260 },
    ], 'paid'),
    mkInvoice(4, 'quote', 3, 'Daniel Okafor', -2, fromQuote(quotes[2]), 'pending'),
  ];

  return { clients, quotes, services, entries, invoices };
}
