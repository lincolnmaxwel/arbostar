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

export interface SendQuoteApprovalEmailOptions {
  to: string;
  clientName: string;
  portalUrl: string;
  total: number;
}

export async function sendQuoteApprovalEmail(opts: SendQuoteApprovalEmailOptions): Promise<void> {
  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: 'Your estimate is ready for review',
    text: `Hi ${opts.clientName},\n\nYour estimate ($${opts.total.toFixed(2)}) is ready for review.\n\nView and respond here: ${opts.portalUrl}\n`,
    html: `
      <p>Hi ${opts.clientName},</p>
      <p>Your estimate ($${opts.total.toFixed(2)}) is ready for review.</p>
      <p><a href="${opts.portalUrl}">View and respond to your estimate</a></p>
    `,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    // Ethereal (or any nodemailer test transport) doesn't deliver anywhere real;
    // this URL is the only way to see what was "sent" during local development.
    console.log(`[email] preview: ${previewUrl}`);
  }
}
