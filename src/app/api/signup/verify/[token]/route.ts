import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { FeatureKey } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashSignupToken, lookupSignup } from '@/lib/signups';
import { trialEndsAtForNewUser } from '@/lib/billing';

// The same default feature set an admin-created staff user gets
// (POST /api/admin/users) — all four, enabled.
const DEFAULT_FEATURES: FeatureKey[] = ['invoices', 'timesheet', 'clients_crm', 'quotes'];

class SignupAlreadyUsedError extends Error {}

// Public endpoint: the unguessable one-time token from the verification email
// is the only credential, the same model as /api/invite/[token]/accept. The
// user row is created here, inside a transaction that also burns the token, so
// a link works exactly once and no user exists until the email is verified.
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

  const lookup = await lookupSignup(params.token);
  if (lookup.state !== 'valid') {
    const message =
      lookup.state === 'expired'
        ? 'This verification link has expired. Start a new sign-up to get another one.'
        : lookup.state === 'used'
          ? 'This verification link was already used. Try signing in.'
          : 'This verification link is not valid.';
    return NextResponse.json({ error: message }, { status: lookup.state === 'invalid' ? 404 : 410 });
  }
  const signup = lookup.signup;

  // A real account appeared for this address since the sign-up was requested
  // (invite accepted, admin-created user, another race winner): keep that
  // account, do not let the stale link create a second one.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: signup.email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists. Try signing in.' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const trialEndsAt = await trialEndsAtForNewUser();
  try {
    const user = await prisma.$transaction(async (tx) => {
      // Burn the token first; count 0 means a concurrent accept already won.
      const burned = await tx.pendingSignup.updateMany({
        where: { tokenHash: hashSignupToken(params.token), acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (burned.count !== 1) throw new SignupAlreadyUsedError();

      const created = await tx.user.create({
        data: {
          name: nameInput || signup.name,
          email: signup.email,
          passwordHash,
          role: 'staff',
          status: 'active',
          trialEndsAt,
          termsAcceptedAt: new Date(),
          termsVersion: signup.termsVersion,
          featureFlags: { create: DEFAULT_FEATURES.map((feature) => ({ feature, enabled: true })) },
        },
      });
      await tx.auditLog.create({
        data: { entityType: 'User', entityId: created.id, action: 'self-signup', actorId: created.id },
      });
      return created;
    });

    return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof SignupAlreadyUsedError) {
      return NextResponse.json({ error: 'This verification link was already used. Try signing in.' }, { status: 410 });
    }
    throw err;
  }
}