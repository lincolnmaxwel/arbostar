import { NextResponse } from 'next/server';
import { requireBillingUser, billingAuthErrorResponse, billingNotConfiguredResponse } from '@/lib/billingAuth';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import { appBaseUrl } from '@/lib/emailLayout';

// Opens the Stripe Customer Portal (update card, invoices history, cancel).
export async function POST() {
  let user;
  try {
    user = await requireBillingUser();
  } catch (err) {
    return billingAuthErrorResponse(err);
  }
  if (!stripeConfigured()) return billingNotConfiguredResponse();
  if (!user.stripeCustomerId) {
    return NextResponse.json({ error: 'There is no billing profile yet. Subscribe first.' }, { status: 400 });
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appBaseUrl()}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[billing/portal] failed', err);
    return NextResponse.json({ error: 'Could not open the billing portal. Please try again.' }, { status: 502 });
  }
}
