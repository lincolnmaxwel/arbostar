// Sends mail via Microsoft Graph (POST /users/{mailbox}/sendMail) using an
// Azure AD app registration's client-credentials flow — app-only auth, no
// user sign-in involved. Requires the app to have application permission
// Mail.Send (admin-consented) and AZURE_SENDER_EMAIL to be a real mailbox
// the app is allowed to send as.

interface GraphAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

interface SendGraphMailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: GraphAttachment[];
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    throw new Error(`Azure AD token request failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

export async function sendGraphMail(opts: SendGraphMailOptions): Promise<void> {
  const token = await getAccessToken();
  const senderEmail = process.env.AZURE_SENDER_EMAIL;

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: opts.subject,
        body: { contentType: 'HTML', content: opts.html },
        toRecipients: [{ emailAddress: { address: opts.to } }],
        attachments: opts.attachments?.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType,
          contentBytes: a.content.toString('base64'),
        })),
      },
      saveToSentItems: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}
