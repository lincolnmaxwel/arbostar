import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { hashInviteToken, lookupInvite } from '@/lib/invites';
import { trialEndsAtForNewUser } from '@/lib/billing';

class InviteAlreadyUsedError extends Error {}

// Public endpoint: the unguessable invite token is the only credential, the
// same model as /api/portal/[token]. The user row is created here, inside a
// transaction that also burns the token, so a link works exactly once.
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const body = (await req.json().catch(() => null)) as { password?: unknown; name?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  const nameInput = typeof body?.name === 'string' ? body.name.trim() : '';

  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json({ error: 'Password is too long.' }, { status: 400 });
  }

  const lookup = await lookupInvite(params.token);
  if (lookup.state !== 'valid') {
    const message =
      lookup.state === 'expired'
        ? 'This invitation has expired. Ask your administrator for a new one.'
        : lookup.state === 'used'
          ? 'This invitation was already used. Try signing in.'
          : 'This invitation link is not valid.';
    return NextResponse.json({ error: message }, { status: lookup.state === 'invalid' ? 404 : 410 });
  }
  const invite = lookup.invite;

  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists. Try signing in.' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const trialEndsAt = await trialEndsAtForNewUser();
  try {
    const user = await prisma.$transaction(async (tx) => {
      // Burn the token first; count 0 means a concurrent accept already won.
      const burned = await tx.userInvite.updateMany({
        where: { tokenHash: hashInviteToken(params.token), acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (burned.count !== 1) throw new InviteAlreadyUsedError();

      const created = await tx.user.create({
        data: {
          name: nameInput || invite.name,
          email: invite.email,
          passwordHash,
          role: invite.role,
          status: 'active',
          hourlyRate: invite.hourlyRate,
          trialEndsAt,
          featureFlags: { create: invite.features.map((feature) => ({ feature, enabled: true })) },
        },
      });
      await tx.auditLog.create({
        data: { entityType: 'User', entityId: created.id, action: 'accept-invite', actorId: invite.invitedById },
      });
      return created;
    });

    return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof InviteAlreadyUsedError) {
      return NextResponse.json({ error: 'This invitation was already used. Try signing in.' }, { status: 410 });
    }
    throw err;
  }
}
