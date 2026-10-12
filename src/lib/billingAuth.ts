import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';

/**
 * Billing always acts on the REAL signed-in user, never the account an admin
 * is viewing as: an admin in view-as mode must not be able to open a Checkout
 * or change the subscription of the user they are looking at.
 */
export async function requireBillingUser() {
  const scope = await requireUserScope();
  const user = await prisma.user.findUnique({ where: { id: scope.actorUserId } });
  if (!user) throw new UnauthorizedError();
  return user;
}

export function billingAuthErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  throw err;
}

export function billingNotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Online payments are not configured yet. Please contact support.' },
    { status: 503 },
  );
}
