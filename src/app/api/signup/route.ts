import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
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

const SUCCESS = {
  ok: true,
  message: 'Check your email to confirm your address. Your account will be ready as soon as you confirm.',
};

const COOLDOWN_MS = SIGNUP_COOLDOWN_MINUTES * 60 * 1000;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; email?: unknown; password?: unknown; acceptTerms?: unknown; website?: unknown }
    | null;

  // Honeypot: real users never see or fill this hidden field, so a non-empty
  // value is a bot — answer the success status and do nothing at all.
  const website = typeof body?.website === 'string' ? body.website : '';
  if (website) return NextResponse.json(SUCCESS);

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: 'Name must be 2 to 100 characters.' }, { status: 400 });
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json({ error: 'Password is too long.' }, { status: 400 });
  }
  if (body?.acceptTerms !== true) {
    return NextResponse.json({ error: 'You must accept the Terms and Privacy Policy.' }, { status: 400 });
  }

  // An account with this address already exists. Case-insensitive: admin-created
  // users keep the email casing as typed. Explicit by owner request — the clear
  // UX wins over anti-enumeration here.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (user) {
    return NextResponse.json(
      { error: 'An account with this email already exists.', code: 'email-exists' },
      { status: 409 },
    );
  }

  // A sign-up for this address was created less than the cooldown ago — the
  // first link is still fresh, so do not send another.
  const since = new Date(Date.now() - COOLDOWN_MS);
  const recent = await prisma.pendingSignup.findFirst({
    where: { email, acceptedAt: null, createdAt: { gt: since } },
    select: { createdAt: true },
  });
  if (recent) {
    const retryAfterMinutes = Math.max(
      1,
      Math.ceil((recent.createdAt.getTime() + COOLDOWN_MS - Date.now()) / 60000),
    );
    return NextResponse.json(
      {
        error: `We already sent a verification link to this email a few minutes ago. Check your inbox and spam folder, or try again in ${retryAfterMinutes} minutes.`,
        code: 'verification-pending',
        retryAfterMinutes,
      },
      { status: 429 },
    );
  }

  // Any older pending row for this address is stale (too old to verify by the
  // time it could be used, or already accepted) — replace it with a fresh one.
  await prisma.pendingSignup.deleteMany({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 10);
  const { token, tokenHash } = generateSignupToken();
  const row = await prisma.pendingSignup.create({
    data: { email, name, passwordHash, tokenHash, termsVersion: TERMS_VERSION, expiresAt: signupExpiry() },
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
    return NextResponse.json(
      { error: 'We could not send the verification email. Please try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json(SUCCESS);
}