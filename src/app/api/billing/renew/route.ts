import { NextResponse } from 'next/server';
import { evaluateBilling } from '@/lib/billing';
import { requireBillingUser, billingAuthErrorResponse, billingNotConfiguredResponse } from '@/lib/billingAuth';
import { describeStripeError, getStripe, stripeConfigured, syncSubscription } from '@/lib/stripe';

// "Renew": undo a scheduled cancellation so the subscription keeps going
// after the current period. A subscription that already ended has to go
// through Checkout again instead.
export async function POST() {
  let user;
  try {
    user = await requireBillingUser();
  } catch (err) {
    return billingAuthErrorResponse(err);
  }
  if (!stripeConfigured()) return billingNotConfiguredResponse();

  const info = evaluateBilling(user);
  if (!info.canRenew || !user.stripeSubscriptionId) {
    return NextResponse.json({ error: 'There is nothing to renew right now.' }, { status: 409 });
  }

  const stripe = getStripe();
  try {
    const current = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const updated = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: false,
      // A cancellation scheduled with an explicit date has to be cleared too.
      ...(current.cancel_at ? { cancel_at: '' as unknown as number } : {}),
    });
    await syncSubscription(updated);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { code } = describeStripeError('subscription renew', err);
    return NextResponse.json(
      { error: `Could not renew the subscription${code ? ` (${code})` : ''}. Please try again.` },
      { status: 502 },
    );
  }
}
