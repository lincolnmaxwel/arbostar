import { NextResponse } from 'next/server';
import { requireBillingUser, billingAuthErrorResponse } from '@/lib/billingAuth';
import { describeStripeError, listPaymentHistory, stripeConfigured } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// The signed-in user's own payment history (Stripe invoices for their
// customer). Always the real user, never the account an admin is viewing as.
export async function GET() {
  let user;
  try {
    user = await requireBillingUser();
  } catch (err) {
    return billingAuthErrorResponse(err);
  }

  if (!user.stripeCustomerId || !stripeConfigured()) {
    return NextResponse.json({ payments: [] });
  }

  try {
    const payments = await listPaymentHistory(user.stripeCustomerId);
    return NextResponse.json({ payments });
  } catch (err) {
    const { code } = describeStripeError('payment history', err);
    return NextResponse.json(
      { error: `Could not load your payment history${code ? ` (${code})` : ''}. Please try again.` },
      { status: 502 },
    );
  }
}
