import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { evaluateBilling } from '@/lib/billing';
import { requireBillingUser, billingAuthErrorResponse, billingNotConfiguredResponse } from '@/lib/billingAuth';
import { describeStripeError, getStripe, stripeConfigured } from '@/lib/stripe';
import { appBaseUrl } from '@/lib/emailLayout';

// Stripe rejects a Checkout trial_end that is less than 48h away; keep a margin.
const MIN_TRIAL_END_MS = 50 * 60 * 60 * 1000;

export async function POST() {
  let user;
  try {
    user = await requireBillingUser();
  } catch (err) {
    return billingAuthErrorResponse(err);
  }
  if (!stripeConfigured()) return billingNotConfiguredResponse();
  if (!(process.env.STRIPE_PRICE_ID as string).startsWith('price_')) {
    console.error('[billing/checkout] STRIPE_PRICE_ID must be a Price id (price_...), not a Product id (prod_...)');
    return NextResponse.json(
      { error: 'Billing is misconfigured: the plan id must start with "price_". Please contact support.' },
      { status: 503 },
    );
  }

  const info = evaluateBilling(user);
  if (info.phase === 'exempt') {
    return NextResponse.json({ error: 'Your account does not need a subscription.' }, { status: 400 });
  }
  if (info.phase === 'subscribed' || info.phase === 'past_due') {
    return NextResponse.json(
      { error: 'You already have a subscription. Use "Manage billing" to change it.' },
      { status: 409 },
    );
  }

  const stripe = getStripe();

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
    } catch (err) {
      const { code } = describeStripeError('customer create', err);
      return NextResponse.json(
        { error: `Could not reach the payment provider${code ? ` (${code})` : ''}. Please try again.` },
        { status: 502 },
      );
    }
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  // Subscribing during the free trial keeps the remaining trial days: the card
  // is collected now and the first charge happens when the trial would end.
  const now = Date.now();
  const trialEnd =
    user.trialEndsAt && user.trialEndsAt.getTime() - now > MIN_TRIAL_END_MS
      ? Math.floor(user.trialEndsAt.getTime() / 1000)
      : null;

  const base = appBaseUrl();
  const useTax = process.env.STRIPE_AUTOMATIC_TAX === 'true';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: process.env.STRIPE_PRICE_ID as string, quantity: 1 }],
      subscription_data: {
        metadata: { userId: user.id },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
      allow_promotion_codes: true,
      success_url: `${base}/billing?checkout=success`,
      cancel_url: `${base}/billing?checkout=canceled`,
      ...(useTax
        ? {
            automatic_tax: { enabled: true },
            billing_address_collection: 'required' as const,
            customer_update: { address: 'auto' as const, name: 'auto' as const },
          }
        : {}),
    });
    if (!session.url) {
      return NextResponse.json({ error: 'Could not start checkout.' }, { status: 502 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const { code } = describeStripeError('checkout session create', err);
    return NextResponse.json(
      { error: `Could not start checkout${code ? ` (${code})` : ''}. Please try again.` },
      { status: 502 },
    );
  }
}
