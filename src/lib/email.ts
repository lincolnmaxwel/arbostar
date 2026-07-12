import { formatMoney } from '@/lib/quoteMath';
import { sendGraphMail } from '@/lib/graphMail';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SendQuoteApprovalEmailItem {
  title: string;
  description?: string | null;
  price: number;
}

export interface SendQuoteApprovalEmailOptions {
  to: string;
  clientName: string;
  portalUrl: string;
  items: SendQuoteApprovalEmailItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  serviceAddress?: string;
}

function buildItemsHtml(items: SendQuoteApprovalEmailItem[]): string {
  return items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px;border-bottom:1px solid #d1d5db;">
            <div style="font-weight:600;">${escapeHtml(item.title)}</div>
            ${item.description ? `<div style="color:#6b7280;font-size:13px;margin-top:4px;">${escapeHtml(item.description)}</div>` : ''}
          </td>
            <td style="padding:12px;border-bottom:1px solid #d1d5db;text-align:right;white-space:nowrap;">${formatMoney(item.price)}</td>
        </tr>`,
    )
    .join('');
}

export async function sendQuoteApprovalEmail(opts: SendQuoteApprovalEmailOptions): Promise<void> {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p>Hi ${escapeHtml(opts.clientName)},</p>
      <p>Your estimate is ready for review:</p>
      ${opts.serviceAddress ? `<p style="color:#6b7280;font-size:14px;margin:-8px 0 16px;">Service address: ${escapeHtml(opts.serviceAddress)}</p>` : ''}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px 12px;background:#2c5f2d;color:#fff;font-size:12px;text-transform:uppercase;">Proposed work</th>
            <th style="text-align:right;padding:10px 12px;background:#2c5f2d;color:#fff;font-size:12px;text-transform:uppercase;">Price</th>
          </tr>
        </thead>
        <tbody>${buildItemsHtml(opts.items)}</tbody>
      </table>
      <table style="width:100%;max-width:280px;margin-left:auto;font-size:14px;color:#6b7280;">
        <tr><td style="padding:4px 0;">Subtotal</td><td style="text-align:right;">${formatMoney(opts.subtotal)}</td></tr>
        <tr><td style="padding:4px 0;">Tax (${(opts.taxRate * 100).toFixed(1)}%)</td><td style="text-align:right;">${formatMoney(opts.taxAmount)}</td></tr>
        <tr>
          <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;">Total</td>
          <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;text-align:right;">${formatMoney(opts.total)}</td>
        </tr>
      </table>
      <p style="margin-top:24px;">
        <a href="${opts.portalUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          View and respond to your estimate
        </a>
      </p>
    </div>
  `;

  await sendGraphMail({
    to: opts.to,
    subject: 'Your estimate is ready for review',
    html,
  });
}

export interface SendBookingProposalEmailOptions {
  to: string;
  clientName: string;
  portalUrl: string;
  roundNumber: number;
  options: { date: string; window: 'morning' | 'afternoon' | 'fullday' }[];
  serviceAddress?: string;
}

const WINDOW_LABEL: Record<'morning' | 'afternoon' | 'fullday', string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function formatOptionDate(dateStr: string): string {
  // dateStr is 'YYYY-MM-DD'; parse at noon local to avoid midnight-UTC edge cases
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function buildOptionsHtml(options: SendBookingProposalEmailOptions['options']): string {
  return options
    .map(
      (o) => `
        <tr>
          <td style="padding:12px;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-weight:600;color:#2c5f2d;">
            ${escapeHtml(formatOptionDate(o.date))}
            <div style="font-weight:400;color:#6b7280;font-size:13px;margin-top:4px;">${escapeHtml(WINDOW_LABEL[o.window])}</div>
          </td>
        </tr>`,
    )
    .join('');
}

export async function sendBookingProposalEmail(opts: SendBookingProposalEmailOptions): Promise<void> {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p>Hi ${escapeHtml(opts.clientName)},</p>
      <p>Your approved estimate is ready to schedule. Here are ${opts.options.length === 1 ? 'the date option we have' : 'the date options we have'} for you (round ${opts.roundNumber}):</p>
      ${opts.serviceAddress ? `<p style="color:#6b7280;font-size:14px;margin:-8px 0 16px;">Service address: ${escapeHtml(opts.serviceAddress)}</p>` : ''}
      <table style="width:100%;border-collapse:separate;border-spacing:0 8px;margin:16px 0;">
        <tbody>${buildOptionsHtml(opts.options)}</tbody>
      </table>
      <p style="margin-top:24px;">
        <a href="${opts.portalUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Choose your date
        </a>
      </p>
    </div>
  `;

  await sendGraphMail({
    to: opts.to,
    subject: 'Scheduling options for your approved estimate',
    html,
  });
}

// --- Staff notifications: the client responded to something, so whoever
// created the quote should hear about it without having to keep checking
// the app. Distinct from the client-facing emails above (sent to `to`,
// which is the User's configured notification address, not the Client's).

export interface SendQuoteDecisionNotificationEmailOptions {
  to: string;
  clientName: string;
  clientPhone?: string;
  serviceAddress?: string;
  quoteNumber: number;
  decision: 'approved' | 'declined';
  quoteUrl: string;
}

function buildContactLinesHtml(clientPhone?: string, serviceAddress?: string): string {
  const lines: string[] = [];
  if (clientPhone) lines.push(`Phone: ${escapeHtml(clientPhone)}`);
  if (serviceAddress) lines.push(`Service address: ${escapeHtml(serviceAddress)}`);
  return lines.length > 0
    ? `<p style="color:#6b7280;font-size:14px;margin:4px 0 0;">${lines.join('<br/>')}</p>`
    : '';
}

export async function sendQuoteDecisionNotificationEmail(opts: SendQuoteDecisionNotificationEmailOptions): Promise<void> {
  const verb = opts.decision === 'approved' ? 'approved' : 'declined';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p><strong>${escapeHtml(opts.clientName)}</strong> just ${verb} quote #${opts.quoteNumber}.</p>
      ${buildContactLinesHtml(opts.clientPhone, opts.serviceAddress)}
      <p style="margin-top:24px;">
        <a href="${opts.quoteUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          View quote
        </a>
      </p>
    </div>
  `;

  await sendGraphMail({
    to: opts.to,
    subject: `Quote #${opts.quoteNumber} was ${verb}`,
    html,
  });
}

export interface SendBookingDecisionNotificationEmailOptions {
  to: string;
  clientName: string;
  clientPhone?: string;
  serviceAddress?: string;
  quoteNumber: number;
  quoteUrl: string;
  decision: 'confirmed' | 'rejected';
  scheduledDate?: string;
  scheduledWindow?: 'morning' | 'afternoon' | 'fullday';
  rejectionReason?: string;
}

export async function sendBookingDecisionNotificationEmail(opts: SendBookingDecisionNotificationEmailOptions): Promise<void> {
  const detail =
    opts.decision === 'confirmed'
      ? `chose ${opts.scheduledDate ? formatOptionDate(opts.scheduledDate) : 'a date'}${opts.scheduledWindow ? ` (${WINDOW_LABEL[opts.scheduledWindow]})` : ''}`
      : `rejected the proposed dates${opts.rejectionReason ? `: "${opts.rejectionReason}"` : ''}`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p><strong>${escapeHtml(opts.clientName)}</strong> ${opts.decision === 'confirmed' ? 'confirmed scheduling' : 'rejected the proposed scheduling'} for quote #${opts.quoteNumber} — ${escapeHtml(detail)}.</p>
      ${buildContactLinesHtml(opts.clientPhone, opts.serviceAddress)}
      <p style="margin-top:24px;">
        <a href="${opts.quoteUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          View quote
        </a>
      </p>
    </div>
  `;

  await sendGraphMail({
    to: opts.to,
    subject: opts.decision === 'confirmed' ? `Scheduling confirmed for quote #${opts.quoteNumber}` : `Scheduling rejected for quote #${opts.quoteNumber}`,
    html,
  });
}

export interface SendPaymentReceivedEmailOptions {
  to: string;
  clientName: string;
  invoiceNumber: number;
  companyName?: string;
  logoUrl?: string;
  items: SendQuoteApprovalEmailItem[];
  total: number;
}

// Sent once, right when staff flips an invoice Pending payment -> Paid — a
// receipt-style confirmation, distinct from sendInvoiceEmail (sent when the
// job is marked Completed, before any payment has happened).
export async function sendPaymentReceivedEmail(opts: SendPaymentReceivedEmailOptions): Promise<void> {
  const from = opts.companyName ? escapeHtml(opts.companyName) : 'us';
  const servicesHtml = opts.items
    .map((item) => `<li style="padding:4px 0;">${escapeHtml(item.title)}</li>`)
    .join('');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;background:#f9fafb;padding:32px 24px;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        ${opts.logoUrl ? `<img src="${opts.logoUrl}" alt="${opts.companyName ? escapeHtml(opts.companyName) : 'Company logo'}" style="display:block;margin:0 auto 16px;max-height:64px;max-width:220px;object-fit:contain;" />` : ''}
        <div style="display:inline-block;background:#2c5f2d;color:#fff;font-weight:700;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;padding:8px 20px;border-radius:999px;">
          ✓ Payment received
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px;">
        <p style="margin-top:0;">Hi ${escapeHtml(opts.clientName)},</p>
        <p>Thank you! We've received your payment for invoice <strong>#${opts.invoiceNumber}</strong>, covering the following services:</p>
        <ul style="margin:16px 0;padding-left:20px;color:#374151;">
          ${servicesHtml}
        </ul>
        <table style="width:100%;max-width:280px;margin:16px 0 0 auto;font-size:14px;color:#6b7280;">
          <tr>
            <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;">Amount paid</td>
            <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;text-align:right;">${formatMoney(opts.total)}</td>
          </tr>
        </table>
        <p style="margin-top:24px;margin-bottom:0;">Thank you for your business with ${from}!</p>
      </div>
    </div>
  `;

  await sendGraphMail({
    to: opts.to,
    subject: `Payment received — Invoice #${opts.invoiceNumber}`,
    html,
  });
}

export interface SendInvoiceEmailOptions {
  to: string;
  clientName: string;
  invoiceNumber: number;
  companyName?: string;
  items: SendQuoteApprovalEmailItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  pdfBuffer?: Buffer;
}

// Sent once, right when staff marks a scheduled job Completed — reuses the
// same item-table builder as the quote-ready email since it's the same
// "title/description/price" shape, just billed instead of proposed.
export async function sendInvoiceEmail(opts: SendInvoiceEmailOptions): Promise<void> {
  const from = opts.companyName ? escapeHtml(opts.companyName) : 'us';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p>Hi ${escapeHtml(opts.clientName)},</p>
      <p>The work is complete! Here is your invoice <strong>#${opts.invoiceNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px 12px;background:#2c5f2d;color:#fff;font-size:12px;text-transform:uppercase;">Description</th>
            <th style="text-align:right;padding:10px 12px;background:#2c5f2d;color:#fff;font-size:12px;text-transform:uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>${buildItemsHtml(opts.items)}</tbody>
      </table>
      <table style="width:100%;max-width:280px;margin-left:auto;font-size:14px;color:#6b7280;">
        <tr><td style="padding:4px 0;">Subtotal</td><td style="text-align:right;">${formatMoney(opts.subtotal)}</td></tr>
        <tr><td style="padding:4px 0;">Tax (${(opts.taxRate * 100).toFixed(1)}%)</td><td style="text-align:right;">${formatMoney(opts.taxAmount)}</td></tr>
        <tr>
          <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;">Total</td>
          <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;text-align:right;">${formatMoney(opts.total)}</td>
        </tr>
      </table>
      <p style="margin-top:24px;">Thank you for your business with ${from}!</p>
    </div>
  `;

  await sendGraphMail({
    to: opts.to,
    subject: `Invoice #${opts.invoiceNumber}`,
    html,
    attachments: opts.pdfBuffer
      ? [{ filename: `invoice-${opts.invoiceNumber}.pdf`, content: opts.pdfBuffer, contentType: 'application/pdf' }]
      : undefined,
  });
}
