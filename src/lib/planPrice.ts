import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';

// Admin-editable subscription price. A Stripe Price is immutable, so "changing
// the price" means pointing at a different Price on the same product:
//   - default price: AppSetting `plan_price_id` (falls back to STRIPE_PRICE_ID)
//   - per-user price: User.customPriceId / customPriceCents (wins over default)
// New checkouts use the user's own price; existing subscriptions are only
// moved when asked (always for a per-user change, opt-in for the default), with
// no proration so the new amount applies from the next renewal.

export const PLAN_PRICE_KEY = 'plan_price_id';
export const MIN_PRICE_CENTS = 50;
export const MAX_PRICE_CENTS = 1_000_000;
const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

export function validPriceCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_PRICE_CENTS && v <= MAX_PRICE_CENTS;
}

export const PRICE_RANGE_MESSAGE = 'Enter a price between $0.50 and $10,000.00.';

export async function getDefaultPriceId(): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: PLAN_PRICE_KEY } });
  return row?.value || (process.env.STRIPE_PRICE_ID as string);
}

export async function priceIdForUser(user: { customPriceId: string | null }): Promise<string> {
  return user.customPriceId || (await getDefaultPriceId());
}

/** Find (or create) a recurring Price with this amount on the same product/currency/interval as `basePriceId`. */
export async function ensurePrice(basePriceId: string, cents: number): Promise<string> {
  const stripe = getStripe();
  const base = await stripe.prices.retrieve(basePriceId);
  const product = typeof base.product === 'string' ? base.product : base.product.id;
  const recurring = base.recurring;
  if (!recurring) throw new Error('The base plan price is not recurring.');

  const existing = await stripe.prices.list({ product, active: true, type: 'recurring', limit: 100 });
  const match = existing.data.find(
    (p) =>
      p.unit_amount === cents &&
      p.currency === base.currency &&
      p.recurring?.interval === recurring.interval &&
      p.recurring?.interval_count === recurring.interval_count &&
      (p.tax_behavior ?? 'unspecified') === (base.tax_behavior ?? 'unspecified'),
  );
  if (match) return match.id;

  const created = await stripe.prices.create({
    product,
    currency: base.currency,
    unit_amount: cents,
    recurring: { interval: recurring.interval, interval_count: recurring.interval_count },
    ...(base.tax_behavior && base.tax_behavior !== 'unspecified' ? { tax_behavior: base.tax_behavior } : {}),
  });
  return created.id;
}

/** Switch a live subscription to another Price; the new amount starts at the next renewal. */
export async function moveSubscriptionToPrice(subscriptionId: string, priceId: string): Promise<void> {
  const stripe = getStripe();
  const sub: Stripe.Subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item || item.price.id === priceId) return;
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: item.id, price: priceId }],
    proration_behavior: 'none',
  });
}

export function hasLiveSubscription(u: { stripeSubscriptionId: string | null; subscriptionStatus: string | null }): boolean {
  return !!u.stripeSubscriptionId && !!u.subscriptionStatus && LIVE_STATUSES.includes(u.subscriptionStatus);
}

/** Set a new default price. Optionally move every current subscriber that has no custom price. */
export async function setDefaultPrice(cents: number, applyToSubscribers: boolean) {
  const basePriceId = await getDefaultPriceId();
  const priceId = await ensurePrice(basePriceId, cents);
  await prisma.appSetting.upsert({
    where: { key: PLAN_PRICE_KEY },
    create: { key: PLAN_PRICE_KEY, value: priceId },
    update: { value: priceId },
  });
  let updated = 0;
  let failed = 0;
  if (applyToSubscribers) {
    const subscribers = await prisma.user.findMany({
      where: { customPriceId: null, stripeSubscriptionId: { not: null }, subscriptionStatus: { in: LIVE_STATUSES } },
      select: { id: true, stripeSubscriptionId: true },
    });
    for (const s of subscribers) {
      try {
        await moveSubscriptionToPrice(s.stripeSubscriptionId as string, priceId);
        updated++;
      } catch (err) {
        failed++;
        console.error('[planPrice] could not move subscription', s.id, err);
      }
    }
  }
  return { priceId, updated, failed };
}

/** Give one user their own price (cents) or clear it (null = back to the default). */
export async function setUserPrice(
  user: { id: string; stripeSubscriptionId: string | null; subscriptionStatus: string | null },
  cents: number | null,
) {
  const defaultId = await getDefaultPriceId();
  const priceId = cents === null ? defaultId : await ensurePrice(defaultId, cents);
  if (hasLiveSubscription(user)) await moveSubscriptionToPrice(user.stripeSubscriptionId as string, priceId);
  return { customPriceId: cents === null ? null : priceId, customPriceCents: cents };
}
