import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { TERMS_VERSION } from '@/lib/legal';
import {
  SIGNUP_COOLDOWN_MINUTES,
  SIGNUP_TTL_HOURS,
  generateSignupToken,
  signupExpiry,
  signupVerifyUrl,
} from '@/lib/signups';
import { sendSignupVerificationEmail } from '@/lib/email';

// Public endpoint. The response is identical whether or not the email already
// has an account (and whether or not it was rate limited), so it cannot be
// used to discover which addresses are registered.
const GENERIC = {
  ok: true,
  message: 'If this email can be used to create an account, a verification link is on its way.',
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; email?: unknown; acceptTerms?: unknown; website?: unknown }
    | null;

  // Honeypot: real users never see or fill this hidden field, so a non-empty
  // value is a bot — answer the generic success and do nothing at all.
  const website = typeof body?.website === 'string' ? body.website : '';
  if (website) return NextResponse.json(GENERIC);

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: 'Name must be 2 to 100 characters.' }, { status: 400 });
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (body?.acceptTerms !== true) {
    return NextResponse.json({ error: 'You must accept the Terms and Privacy Policy.' }, { status: 400 });
  }

  // An account with this address already exists — no email, same answer.
  // Case-insensitive: accounts created by an admin keep the casing as typed.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (user) return NextResponse.json(GENERIC);

  // A sign-up for this address was created less than the cooldown ago — the
  // first link is still fresh, so do not send another.
  const since = new Date(Date.now() - SIGNUP_COOLDOWN_MINUTES * 60 * 1000);
  const recent = await prisma.pendingSignup.findFirst({
    where: { email, createdAt: { gt: since } },
    select: { id: true },
  });
  if (recent) return NextResponse.json(GENERIC);

  // Any older pending row for this address is stale (too old to verify by the
  // time it could be used, or already accepted) — replace it with a fresh one.
  await prisma.pendingSignup.deleteMany({ where: { email } });
  const { token, tokenHash } = generateSignupToken();
  const row = await prisma.pendingSignup.create({
    data: { email, name, tokenHash, termsVersion: TERMS_VERSION, expiresAt: signupExpiry() },
  });

  try {
    await sendSignupVerificationEmail({
      to: email,
      name,
      verifyUrl: signupVerifyUrl(token),
      expiresInHours: SIGNUP_TTL_HOURS,
    });
  } catch (err) {
    console.error('[signup] email failed', err);
    // Nothing was delivered, so drop the row — the next request can retry.
    await prisma.pendingSignup.delete({ where: { id: row.id } }).catch(() => undefined);
  }

  return NextResponse.json(GENERIC);
}