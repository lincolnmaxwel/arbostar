// Sends mail through Resend's REST API (POST https://api.resend.com/emails).
// Selected when RESEND_API_KEY is set — see sendGraphMail in graphMail.ts.
//
//   RESEND_API_KEY   API key with "Sending access"
//   MAIL_FROM_ADDRESS  verified sender address (default noreply@myjobbs.com)
//   MAIL_FROM_NAME     default display name (default "MyJobbs")

export interface ResendMailOptions {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

/** Display names go inside "Name <addr>": strip anything that could break it. */
function cleanDisplayName(value: string): string {
  return value.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function buildFromHeader(fromName?: string): string {
  const address = process.env.MAIL_FROM_ADDRESS || 'noreply@myjobbs.com';
  const name = cleanDisplayName(fromName || process.env.MAIL_FROM_NAME || 'MyJobbs');
  return name ? `${name} <${address}>` : address;
}

export async function sendResendMail(opts: ResendMailOptions): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: buildFromHeader(opts.fromName),
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      ...(opts.attachments?.length
        ? {
            attachments: opts.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString('base64'),
            })),
          }
        : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}
