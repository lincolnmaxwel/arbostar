import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { addBillingInterval, evaluateBilling, MIN_TRIAL_END_MS } from '@/lib/billing';
import { requireBillingUser, billingAuthErrorResponse, billingNotConfiguredResponse } from '@/lib/billingAuth';
import { describeStripeError, getPlanPrice, getStripe, stripeConfigured } from '@/lib/stripe';
import { appBaseUrl } from '@/lib/emailLayout';
import { getDefaultPriceId, priceIdForUser } from '@/lib/planPrice';

export async function POST() {
  let user;
  try {
    user = await requireBillingUser();
  } catch (err) {
    return billingAuthErrorResponse(err);
  }
  if (!stripeConfigured()) return billingNotConfiguredResponse();
  const priceId = await priceIdForUser(user);
  if (!priceId.startsWith('price_') || !(await getDefaultPriceId()).startsWith('price_')) {
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

  // Subscribing during the free trial keeps the remaining trial days AND bills
  // a full period now: the first period is charged at checkout as a one-time
  // line item and Stripe's trial is stretched by one billing interval, so the
  // first renewal lands at (trial end + 1 period). With too little trial left
  // for Stripe to defer, the subscription simply starts today.
  const now = Date.now();
  const hasTrialLeft = !!user.trialEndsAt && user.trialEndsAt.getTime() - now > MIN_TRIAL_END_MS;
  const plan = hasTrialLeft ? await getPlanPrice(priceId) : null;
  const prepay = hasTrialLeft && !!plan;
  let trialEnd: number | null = null;
  if (hasTrialLeft && user.trialEndsAt) {
    const end = prepay && plan ? addBillingInterval(user.trialEndsAt, plan.interval, plan.intervalCount) : user.trialEndsAt;
    trialEnd = Math.floor(end.getTime() / 1000);
  }

  // Stripe labels a deferred first charge as "N days free" (trial days + the
  // prepaid period), which reads oddly. Spell out what is actually happening.
  let explanation: string | null = null;
  if (prepay && plan && user.trialEndsAt && trialEnd) {
    const trialDaysLeft = Math.max(1, Math.ceil((user.trialEndsAt.getTime() - now) / (24 * 60 * 60 * 1000)));
    const formatDay = (d: Date) =>
      d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const amount = new Intl.NumberFormat('en-CA', { style: 'currency', currency: plan.currency.toUpperCase() }).format(
      plan.unitAmount / 100,
    );
    explanation =
      `You are paying ${amount} today for your first month. Your ${trialDaysLeft} remaining free trial ` +
      `day${trialDaysLeft === 1 ? '' : 's'} are kept, which is why the total free period is longer than your trial. ` +
      `Your first renewal is on ${formatDay(new Date(trialEnd * 1000))}.`;
  }

  const base = appBaseUrl();
  const useTax = process.env.STRIPE_AUTOMATIC_TAX === 'true';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        { price: priceId, quantity: 1 },
        ...(prepay && plan?.productId
          ? [
              {
                price_data: {
                  currency: plan.currency.toLowerCase(),
                  product_data: { name: 'MyJobbs - first month (paid today)' },
                  unit_amount: plan.unitAmount,
                },
                quantity: 1,
              },
            ]
          : []),
      ],
      subscription_data: {
        metadata: { userId: user.id },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
      ...(explanation ? { custom_text: { submit: { message: explanation } } } : {}),
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
