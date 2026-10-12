import { NextResponse } from 'next/server';
import { evaluateBilling, getTrialDays, renewalAfterSubscribe, RENEW_WINDOW_DAYS } from '@/lib/billing';
import { requireBillingUser, billingAuthErrorResponse } from '@/lib/billingAuth';
import { getPlanPrice, stripeConfigured } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function GET() {
  let user;
  try {
    user = await requireBillingUser();
  } catch (err) {
    return billingAuthErrorResponse(err);
  }

  const [plan, trialDays] = await Promise.all([getPlanPrice(), getTrialDays()]);
  // What subscribing right now would do to a user still in their free trial.
  const renewal = plan ? renewalAfterSubscribe(user.trialEndsAt, plan.interval, plan.intervalCount) : null;
  const billing = evaluateBilling(user);

  return NextResponse.json({
    billing,
    subscribePreview: billing.phase === 'trial' && renewal ? { firstRenewalAt: renewal.toISOString() } : null,
    configured: stripeConfigured(),
    plan,
    trialDays,
    renewWindowDays: RENEW_WINDOW_DAYS,
  });
}
