import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { hashResetToken, lookupReset } from '@/lib/passwordReset';

class ResetAlreadyUsedError extends Error {}

// Public endpoint: the unguessable reset token is the only credential. The
// password is changed in the same transaction that burns the token, so a link
// works exactly once.
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json({ error: 'Password is too long.' }, { status: 400 });
  }

  const lookup = await lookupReset(params.token);
  if (lookup.state !== 'valid') {
    const message =
      lookup.state === 'expired'
        ? 'This reset link has expired. Request a new one from the sign-in page.'
        : lookup.state === 'used'
          ? 'This reset link was already used. Request a new one from the sign-in page.'
          : 'This reset link is not valid.';
    return NextResponse.json({ error: message }, { status: lookup.state === 'invalid' ? 404 : 410 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.$transaction(async (tx) => {
      const burned = await tx.passwordReset.updateMany({
        where: { tokenHash: hashResetToken(params.token), usedAt: null },
        data: { usedAt: new Date() },
      });
      if (burned.count !== 1) throw new ResetAlreadyUsedError();

      await tx.user.update({ where: { id: lookup.reset.userId }, data: { passwordHash, sessionId: randomUUID() } });
      // Any other outstanding link for this account dies with this one.
      await tx.passwordReset.updateMany({
        where: { userId: lookup.reset.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          entityType: 'User',
          entityId: lookup.reset.userId,
          action: 'password-reset',
          actorId: lookup.reset.userId,
        },
      });
    });
  } catch (err) {
    if (err instanceof ResetAlreadyUsedError) {
      return NextResponse.json({ error: 'This reset link was already used. Request a new one from the sign-in page.' }, { status: 410 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
