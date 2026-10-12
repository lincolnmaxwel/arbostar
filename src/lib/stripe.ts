import Stripe from 'stripe';
import { prisma } from '@/lib/db';

// Stripe integration helpers. Environment:
//   STRIPE_SECRET_KEY      sk_test_... / sk_live_...
//   STRIPE_WEBHOOK_SECRET  whsec_... (signing secret of the webhook endpoint)
//   STRIPE_PRICE_ID        price_... of the monthly plan
//   STRIPE_AUTOMATIC_TAX   "true" to let Stripe Tax add GST/HST (needs Stripe Tax set up)

let client: Stripe | null = null;

/**
 * Log a Stripe SDK failure with everything needed to diagnose it and return
 * the short, non-sensitive Stripe error code (e.g. "resource_missing") so the
 * UI can show something actionable instead of a bare 502.
 */
export function describeStripeError(context: string, err: unknown): { code: string | null; message: string } {
  if (err instanceof Stripe.errors.StripeError) {
    console.error(`[stripe] ${context} failed:`, err.type, err.code ?? '-', err.message);
    return { code: err.code ?? err.type, message: err.message };
  }
  console.error(`[stripe] ${context} failed:`, err);
  return { code: null, message: err instanceof Error ? err.message : 'unknown error' };
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (!client) client = new Stripe(key);
  return client;
}

/** End of the current paid period. Newer Stripe API versions moved it onto the subscription items. */
function periodEndOf(sub: Stripe.Subscription): Date | null {
  const loose = sub as unknown as { current_period_end?: number };
  const itemEnd = (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  const seconds = itemEnd ?? loose.current_period_end ?? null;
  return seconds ? new Date(seconds * 1000) : null;
}

function customerIdOf(sub: Stripe.Subscription): string {
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
}

/**
 * Mirror a Stripe subscription onto the owning user. Matches by the userId we
 * stamped into the subscription metadata at Checkout, falling back to the
 * Stripe customer id. Returns the user id that was updated (or null).
 */
export async function syncSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const customerId = customerIdOf(sub);
  const metaUserId = sub.metadata?.userId;

  const select = { id: true, stripeSubscriptionId: true } as const;
  let user = metaUserId ? await prisma.user.findUnique({ where: { id: metaUserId }, select }) : null;
  if (!user) user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select });
  if (!user) return null;

  // A subscription that ended and is not the one currently tracked on the user
  // (an admin deleted it, or it was replaced by a newer one) must not
  // overwrite the account's state with a stale "canceled".
  const terminal = sub.status === 'canceled' || sub.status === 'incomplete_expired';
  if (terminal && user.stripeSubscriptionId !== sub.id) return null;

  // A subscription scheduled to end via cancel_at (instead of cancel_at_period_end) counts too.
  const cancelScheduled = sub.cancel_at_period_end || !!sub.cancel_at;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      subscriptionPeriodEnd: periodEndOf(sub),
      subscriptionCancelAtPeriodEnd: cancelScheduled,
    },
  });
  return user.id;
}

/** Retrieve the latest copy first so out-of-order webhook deliveries cannot regress the state. */
export async function syncSubscriptionById(subscriptionId: string, fallback?: Stripe.Subscription): Promise<string | null> {
  try {
    const fresh = await getStripe().subscriptions.retrieve(subscriptionId);
    return await syncSubscription(fresh);
  } catch (err) {
    if (fallback) return syncSubscription(fallback);
    throw err;
  }
}

let priceCache: { at: number; value: PlanPrice | null } | null = null;

export interface PlanPrice {
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  /** Stripe product id and amount in cents, used to bill one period up front. */
  productId: string | null;
  unitAmount: number;
}

/** Display price of the configured plan (cached for 10 minutes; null when unavailable). */
export async function getPlanPrice(): Promise<PlanPrice | null> {
  if (!stripeConfigured()) return null;
  if (priceCache && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.value;
  try {
    const price = await getStripe().prices.retrieve(process.env.STRIPE_PRICE_ID as string);
    const value =
      price.unit_amount != null
        ? {
            amount: price.unit_amount / 100,
            currency: price.currency.toUpperCase(),
            interval: price.recurring?.interval ?? 'month',
            intervalCount: price.recurring?.interval_count ?? 1,
            productId: typeof price.product === 'string' ? price.product : (price.product?.id ?? null),
            unitAmount: price.unit_amount,
          }
        : null;
    priceCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error('[stripe] could not load plan price', err);
    return null;
  }
}
