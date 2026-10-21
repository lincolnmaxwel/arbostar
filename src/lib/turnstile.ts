// Cloudflare Turnstile (robot check) for the public forms: sign-up and the
// landing-page contact form. Server side only; the widget lives in
// src/components/TurnstileWidget.tsx.
//
// Env: TURNSTILE_SITE_KEY (public, handed to the pages at request time) and
// TURNSTILE_SECRET_KEY (server). With no secret key the check is off, so
// local development and tests keep working without Cloudflare.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileSiteKey(): string {
  return process.env.TURNSTILE_SITE_KEY?.trim() ?? '';
}

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export const TURNSTILE_ERROR = 'Please complete the robot check and try again.';

/**
 * True when the token is valid (or the check is not configured). A missing or
 * rejected token, or a Cloudflare outage, is a failure: the form stays closed
 * rather than letting unverified traffic through.
 */
export async function verifyTurnstile(token: unknown, ip?: string): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  try {
    const form = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY as string, response: token });
    if (ip && ip !== 'unknown') form.set('remoteip', ip);
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch (err) {
    console.error('[turnstile] verification request failed', err);
    return false;
  }
}

/** Client IP behind the reverse proxy (nginx sets x-forwarded-for). */
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}
