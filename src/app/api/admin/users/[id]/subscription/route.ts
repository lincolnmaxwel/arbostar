import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { evaluateBilling } from '@/lib/billing';
import { describeStripeError, getStripe } from '@/lib/stripe';

/**
 * Admin: delete a user's subscription. Cancels it in Stripe immediately (no
 * refund, no proration) and clears the local subscription fields, so the
 * account falls back to its trial window: still inside it, the account is on
 * trial again; past it, the account is locked as "trial ended". The Stripe
 * customer is kept so the user can subscribe again with their saved details.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (!target.stripeSubscriptionId && !target.subscriptionStatus) {
    return NextResponse.json({ error: 'This user has no subscription.' }, { status: 409 });
  }

  // Cancel at Stripe first; only clear local state once that succeeded (or the
  // subscription is already gone there / Stripe is not configured here).
  if (target.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
    try {
      await getStripe().subscriptions.cancel(target.stripeSubscriptionId);
    } catch (err) {
      const { code } = describeStripeError('subscription cancel', err);
      if (code !== 'resource_missing') {
        return NextResponse.json(
          { error: `Could not cancel the subscription in Stripe${code ? ` (${code})` : ''}. Nothing was changed.` },
          { status: 502 },
        );
      }
    }
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: {
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      subscriptionPeriodEnd: null,
      subscriptionCancelAtPeriodEnd: false,
    },
  });
  await auditAdminAction(actorId, 'User', target.id, 'delete-subscription');

  const billing = evaluateBilling(updated);
  return NextResponse.json({ ok: true, phase: billing.phase, access: billing.access });
}
