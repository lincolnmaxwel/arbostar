// Landing-page contact section: where requests go and the WhatsApp shortcut.

/** Inbox that receives contact-form requests (override with CONTACT_TO_EMAIL). */
export function contactRecipient(): string {
  return process.env.CONTACT_TO_EMAIL?.trim() || 'lincolnmaxwel@hotmail.com';
}

/** WhatsApp number in international format, digits only (wa.me style). */
export const WHATSAPP_NUMBER = '5511984704925';
export const WHATSAPP_DISPLAY = '+55 11 98470-4925';

export function whatsappUrl(text = 'Hi! I would like to know more about MyJobbs.'): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export const CONTACT_LIMITS = { nameMax: 100, emailMax: 254, phoneMax: 40, messageMin: 10, messageMax: 2000 };

// Best-effort throttle per IP (in memory, per server process): enough to stop a
// script from flooding the inbox, the honeypot handles the simple bots.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export function contactRateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
  }
  return false;
}
