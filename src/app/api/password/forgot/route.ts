import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';
import {
  RESET_COOLDOWN_MINUTES,
  RESET_TTL_MINUTES,
  generateResetToken,
  resetUrl,
} from '@/lib/passwordReset';

// Public endpoint. The response is identical whether or not the email belongs
// to an account (and whether or not it was rate limited), so it cannot be used
// to discover which emails are registered.
const GENERIC = {
  ok: true,
  message: `If an account exists for that email, a reset link is on its way. You can request a new link every ${RESET_COOLDOWN_MINUTES} minutes.`,
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  // Emails are stored as typed at creation; match case-insensitively.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, status: true },
  });
  if (!user || user.status !== 'active') return NextResponse.json(GENERIC);

  const since = new Date(Date.now() - RESET_COOLDOWN_MINUTES * 60 * 1000);
  const recent = await prisma.passwordReset.findFirst({
    where: { userId: user.id, createdAt: { gt: since } },
    select: { id: true },
  });
  if (recent) return NextResponse.json(GENERIC);

  const { token, tokenHash } = generateResetToken();
  const created = await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
    },
  });

  try {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl: resetUrl(token),
      expiresInMinutes: RESET_TTL_MINUTES,
    });
  } catch (err) {
    console.error('[password-reset] email failed', err);
    // Nothing was delivered, so do not make the user wait out the cooldown.
    await prisma.passwordReset.delete({ where: { id: created.id } }).catch(() => undefined);
  }

  return NextResponse.json(GENERIC);
}
