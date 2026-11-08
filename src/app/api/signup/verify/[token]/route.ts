import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashSignupToken, lookupSignup } from '@/lib/signups';

// Public endpoint: the unguessable one-time token from the verification email
// is the only credential, the same model as /api/invite/[token]/accept. No
// body needed. This route only confirms the address; an admin then approves
// (creates the user, see /api/admin/signup-requests/[id]/approve) or denies.
export async function POST(req: Request, { params }: { params: { token: string } }) {
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

  // Pre-existing rows (created before the password-at-signup change) carry no
  // password and can never become an account. Case-insensitive check:
  // admin-created users keep the email casing as typed.
  if (!signup.passwordHash) {
    return NextResponse.json({ error: 'This sign-up link is no longer valid. Please sign up again.' }, { status: 410 });
  }

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

  // Confirming the address does NOT create an account any more: sign-up is
  // invite-only, so the request now waits in the admin approval queue
  // (`emailVerifiedAt` set, `acceptedAt` null). The token is burned here.
  const burned = await prisma.pendingSignup.updateMany({
    where: { tokenHash: hashSignupToken(params.token), emailVerifiedAt: null, acceptedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
  if (burned.count !== 1) {
    return NextResponse.json({ error: 'This verification link was already used.' }, { status: 410 });
  }

  return NextResponse.json({ ok: true, email: signup.email }, { status: 200 });
}
