import nodemailer, { Transporter } from 'nodemailer';
import { formatMoney } from '@/lib/quoteMath';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

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

function buildItemsText(items: SendQuoteApprovalEmailItem[]): string {
  return items.map((item) => `- ${item.title}${item.description ? ` (${item.description})` : ''}: ${formatMoney(item.price)}`).join('\n');
}

export async function sendQuoteApprovalEmail(opts: SendQuoteApprovalEmailOptions): Promise<void> {
  const text = `Hi ${opts.clientName},

Your estimate is ready for review.

${buildItemsText(opts.items)}

Subtotal: ${formatMoney(opts.subtotal)}
Tax (${(opts.taxRate * 100).toFixed(1)}%): ${formatMoney(opts.taxAmount)}
Total: ${formatMoney(opts.total)}

View and respond here: ${opts.portalUrl}
`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p>Hi ${escapeHtml(opts.clientName)},</p>
      <p>Your estimate is ready for review:</p>
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

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: 'Your estimate is ready for review',
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    // Ethereal (or any nodemailer test transport) doesn't deliver anywhere real;
    // this URL is the only way to see what was "sent" during local development.
    console.log(`[email] preview: ${previewUrl}`);
  }
}

export interface SendBookingProposalEmailOptions {
  to: string;
  clientName: string;
  portalUrl: string;
  roundNumber: number;
  options: { date: string; window: 'morning' | 'afternoon' | 'fullday' }[];
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

function buildOptionsText(options: SendBookingProposalEmailOptions['options']): string {
  return options.map((o) => `- ${formatOptionDate(o.date)} — ${WINDOW_LABEL[o.window]}`).join('\n');
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
  const text = `Hi ${opts.clientName},

Your approved estimate is ready to schedule. Round ${opts.roundNumber} of date proposals:

${buildOptionsText(opts.options)}

Pick the one that works for you here: ${opts.portalUrl}
`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p>Hi ${escapeHtml(opts.clientName)},</p>
      <p>Your approved estimate is ready to schedule. Here are ${opts.options.length === 1 ? 'the date option we have' : 'the date options we have'} for you (round ${opts.roundNumber}):</p>
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

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: 'Scheduling options for your approved estimate',
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[email] booking proposal preview: ${previewUrl}`);
  }
}

// --- Staff notifications: the client responded to something, so whoever
// created the quote should hear about it without having to keep checking
// the app. Distinct from the client-facing emails above (sent to `to`,
// which is the User's configured notification address, not the Client's).

export interface SendQuoteDecisionNotificationEmailOptions {
  to: string;
  clientName: string;
  quoteNumber: number;
  decision: 'approved' | 'declined';
  quoteUrl: string;
}

export async function sendQuoteDecisionNotificationEmail(opts: SendQuoteDecisionNotificationEmailOptions): Promise<void> {
  const verb = opts.decision === 'approved' ? 'approved' : 'declined';
  const text = `${opts.clientName} just ${verb} quote #${opts.quoteNumber}.\n\nView it here: ${opts.quoteUrl}\n`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p><strong>${escapeHtml(opts.clientName)}</strong> just ${verb} quote #${opts.quoteNumber}.</p>
      <p style="margin-top:24px;">
        <a href="${opts.quoteUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          View quote
        </a>
      </p>
    </div>
  `;

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: `Quote #${opts.quoteNumber} was ${verb}`,
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[email] quote decision notification preview: ${previewUrl}`);
  }
}

export interface SendBookingDecisionNotificationEmailOptions {
  to: string;
  clientName: string;
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

  const text = `${opts.clientName} just ${opts.decision === 'confirmed' ? 'confirmed scheduling' : 'rejected the proposed scheduling'} for quote #${opts.quoteNumber} — ${detail}.\n\nView it here: ${opts.quoteUrl}\n`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p><strong>${escapeHtml(opts.clientName)}</strong> ${opts.decision === 'confirmed' ? 'confirmed scheduling' : 'rejected the proposed scheduling'} for quote #${opts.quoteNumber} — ${escapeHtml(detail)}.</p>
      <p style="margin-top:24px;">
        <a href="${opts.quoteUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          View quote
        </a>
      </p>
    </div>
  `;

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: opts.decision === 'confirmed' ? `Scheduling confirmed for quote #${opts.quoteNumber}` : `Scheduling rejected for quote #${opts.quoteNumber}`,
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[email] booking decision notification preview: ${previewUrl}`);
  }
}
