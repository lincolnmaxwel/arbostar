import nodemailer, { Transporter } from 'nodemailer';

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
          <td style="padding:12px;border-bottom:1px solid #d1d5db;text-align:right;white-space:nowrap;">$${item.price.toFixed(2)}</td>
        </tr>`,
    )
    .join('');
}

function buildItemsText(items: SendQuoteApprovalEmailItem[]): string {
  return items.map((item) => `- ${item.title}${item.description ? ` (${item.description})` : ''}: $${item.price.toFixed(2)}`).join('\n');
}

export async function sendQuoteApprovalEmail(opts: SendQuoteApprovalEmailOptions): Promise<void> {
  const text = `Hi ${opts.clientName},

Your estimate is ready for review.

${buildItemsText(opts.items)}

Subtotal: $${opts.subtotal.toFixed(2)}
Tax (${(opts.taxRate * 100).toFixed(1)}%): $${opts.taxAmount.toFixed(2)}
Total: $${opts.total.toFixed(2)}

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
        <tr><td style="padding:4px 0;">Subtotal</td><td style="text-align:right;">$${opts.subtotal.toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0;">Tax (${(opts.taxRate * 100).toFixed(1)}%)</td><td style="text-align:right;">$${opts.taxAmount.toFixed(2)}</td></tr>
        <tr>
          <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;">Total</td>
          <td style="padding:8px 0;border-top:1px solid #d1d5db;font-weight:700;font-size:16px;color:#111827;text-align:right;">$${opts.total.toFixed(2)}</td>
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
