import { NextResponse } from 'next/server';
import { requireAdminSession, auditAdminAction } from '@/lib/userScope';
import { adminAuthErrorResponse } from '@/lib/adminAuth';
import { getTrialDays, setTrialDays, MAX_TRIAL_DAYS } from '@/lib/billing';
import { describeStripeError, stripeConfigured } from '@/lib/stripe';
import { PRICE_RANGE_MESSAGE, setDefaultPrice, validPriceCents } from '@/lib/planPrice';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }
  return NextResponse.json({ trialDays: await getTrialDays(), maxTrialDays: MAX_TRIAL_DAYS });
}

export async function PATCH(req: Request) {
  let actorId: string;
  try {
    actorId = await requireAdminSession();
  } catch (err) {
    return adminAuthErrorResponse(err);
  }

  const body = (await req.json().catch(() => null)) as {
    trialDays?: unknown;
    priceCents?: unknown;
    applyToSubscribers?: unknown;
  } | null;

  // Default plan price (what new subscribers pay). Accounts with their own
  // price keep it; current subscribers only move when applyToSubscribers is set.
  if (body?.priceCents !== undefined) {
    if (!validPriceCents(body.priceCents)) {
      return NextResponse.json({ error: PRICE_RANGE_MESSAGE }, { status: 400 });
    }
    if (!stripeConfigured()) {
      return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 });
    }
    try {
      const result = await setDefaultPrice(body.priceCents, body.applyToSubscribers === true);
      await auditAdminAction(actorId, 'AppSetting', 'plan_price_id', 'update');
      return NextResponse.json({ priceCents: body.priceCents, updated: result.updated, failed: result.failed });
    } catch (err) {
      const { code } = describeStripeError('set default price', err);
      return NextResponse.json({ error: `Could not change the price in Stripe${code ? ` (${code})` : ''}.` }, { status: 502 });
    }
  }

  const days = body?.trialDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_TRIAL_DAYS) {
    return NextResponse.json(
      { error: `Trial length must be a whole number of days between 0 and ${MAX_TRIAL_DAYS}.` },
      { status: 400 },
    );
  }

  await setTrialDays(days);
  await auditAdminAction(actorId, 'AppSetting', 'trial_days', 'update');
  return NextResponse.json({ trialDays: days });
}
