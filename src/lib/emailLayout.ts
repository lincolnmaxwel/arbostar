// Shared HTML shell for every transactional email: MyJobbs logo header, a
// white card for the message and a small footer. Table-based with inline
// styles because email clients ignore most modern CSS.
//
// The logo must be an absolute https URL the recipient's mail client can
// fetch — it is served from /public/brand on the app's own domain
// (NEXTAUTH_URL), so it only shows once the app is deployed on a public host.

const BRAND_BLUE = '#075bff';
const BRAND_NAVY = '#071b49';

export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://myjobbs.com').replace(/\/+$/, '');
}

export function brandLogoUrl(): string {
  return `${appBaseUrl()}/brand/myjobbs-logo2.png`;
}

export function emailLayout(bodyHtml: string): string {
  const base = appBaseUrl();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
  </head>
  <body style="margin:0;padding:0;background:#f2f6fc;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6fc;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #d9e1ef;">
            <tr>
              <td style="height:4px;line-height:4px;font-size:0;background:${BRAND_BLUE};background-image:linear-gradient(90deg,#075bff,#009fff 55%,#00d6db);">&nbsp;</td>
            </tr>
            <tr>
              <td align="left" style="padding:22px 28px 6px;background:#ffffff;">
                <a href="${base}" style="text-decoration:none;">
                  <img src="${brandLogoUrl()}" alt="MyJobbs.com" width="190" style="display:block;border:0;outline:none;height:auto;width:190px;max-width:100%;" />
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:${BRAND_NAVY};">
                ${bodyHtml}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:#5a6785;">
            Sent via <a href="${base}" style="color:${BRAND_BLUE};text-decoration:none;">MyJobbs.com</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
