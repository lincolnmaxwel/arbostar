import { NextResponse } from 'next/server';
import { evaluateBilling, getTrialDays, RENEW_WINDOW_DAYS } from '@/lib/billing';
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
  return NextResponse.json({
    billing: evaluateBilling(user),
    configured: stripeConfigured(),
    plan,
    trialDays,
    renewWindowDays: RENEW_WINDOW_DAYS,
  });
}
