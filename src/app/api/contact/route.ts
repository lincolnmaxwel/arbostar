import { NextResponse } from 'next/server';
import { CONTACT_LIMITS, contactRateLimited } from '@/lib/contact';
import { sendContactRequestEmail } from '@/lib/email';

const SUCCESS = { ok: true, message: 'Thanks! Your message was sent. We will get back to you soon.' };

// Public endpoint (landing page contact form): no session, guarded by a hidden
// honeypot field and a per-IP throttle.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; email?: unknown; phone?: unknown; message?: unknown; website?: unknown }
    | null;

  // Real users never see the honeypot; a filled value is a bot, so answer the
  // success status and send nothing.
  if (typeof body?.website === 'string' && body.website) return NextResponse.json(SUCCESS);

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  if (name.length < 2 || name.length > CONTACT_LIMITS.nameMax) {
    return NextResponse.json({ error: 'Name must be 2 to 100 characters.' }, { status: 400 });
  }
  if (!email || email.length > CONTACT_LIMITS.emailMax || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (phone.length > CONTACT_LIMITS.phoneMax) {
    return NextResponse.json({ error: 'Phone number is too long.' }, { status: 400 });
  }
  if (message.length < CONTACT_LIMITS.messageMin || message.length > CONTACT_LIMITS.messageMax) {
    return NextResponse.json(
      { error: `Message must be ${CONTACT_LIMITS.messageMin} to ${CONTACT_LIMITS.messageMax} characters.` },
      { status: 400 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (contactRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many messages from your connection. Please try again later or use WhatsApp.' },
      { status: 429 },
    );
  }

  try {
    await sendContactRequestEmail({ name, email, phone: phone || undefined, message });
  } catch (err) {
    console.error('[contact] email failed', err);
    return NextResponse.json(
      { error: 'We could not send your message. Please try again or use WhatsApp.' },
      { status: 502 },
    );
  }

  return NextResponse.json(SUCCESS);
}
