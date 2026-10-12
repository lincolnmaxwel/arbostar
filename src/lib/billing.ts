import { prisma } from '@/lib/db';

// Subscription / trial access rules. Kept free of Stripe imports so the same
// evaluation runs in the feature gate, the view-context API and the billing
// page without pulling the SDK into every route.

export const TRIAL_DAYS_KEY = 'trial_days';
export const DEFAULT_TRIAL_DAYS = 15;
export const MAX_TRIAL_DAYS = 365;
/** The "Renew" prompt shows once this few days remain. */
export const RENEW_WINDOW_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stripe statuses that keep the account working. past_due stays open while Stripe retries the card. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type BillingPhase =
  | 'exempt'
  | 'subscribed'
  | 'past_due'
  | 'trial'
  | 'trial_ended'
  | 'canceled';

export interface BillingUserFields {
  role: 'admin' | 'staff';
  billingExempt: boolean;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: Date | null;
  subscriptionCancelAtPeriodEnd: boolean;
}

export interface BillingInfo {
  /** Whether the account may use the app right now. */
  access: boolean;
  phase: BillingPhase;
  /** Raw Stripe status, when there is a subscription record. */
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Whole days until the trial / current period ends (null when not applicable). */
  daysLeft: number | null;
  /** Inside the last RENEW_WINDOW_DAYS of a trial or paid period. */
  inRenewWindow: boolean;
  /** Subscribed and Stripe will charge again on its own. */
  autoRenews: boolean;
  /** May start a new subscription through Checkout. */
  canSubscribe: boolean;
  /** Has a scheduled cancellation that can be undone ("Renew"). */
  canRenew: boolean;
  /** Has a Stripe customer, so the billing portal is available. */
  canManage: boolean;
}

function daysUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS));
}

export function evaluateBilling(user: BillingUserFields, now: Date = new Date()): BillingInfo {
  const hasSubscription = !!user.stripeSubscriptionId;
  const live = hasSubscription && LIVE_STATUSES.has(user.subscriptionStatus ?? '');
  const trialLive = !!user.trialEndsAt && user.trialEndsAt.getTime() > now.getTime();

  // A row with no trial window and no subscription predates billing (or was
  // created outside the invite/admin flows that stamp trialEndsAt): treat it
  // as not billed rather than locking it out.
  const legacy = !user.trialEndsAt && !hasSubscription;

  let phase: BillingPhase;
  if (user.role === 'admin' || user.billingExempt || legacy) phase = 'exempt';
  else if (live && user.subscriptionStatus === 'past_due') phase = 'past_due';
  else if (live) phase = 'subscribed';
  else if (trialLive) phase = 'trial';
  else if (hasSubscription) phase = 'canceled';
  else phase = 'trial_ended';

  const access = phase === 'exempt' || phase === 'subscribed' || phase === 'past_due' || phase === 'trial';

  let endsAt: Date | null = null;
  if (phase === 'trial') endsAt = user.trialEndsAt;
  else if (phase === 'subscribed' || phase === 'past_due') endsAt = user.subscriptionPeriodEnd;
  const daysLeft = endsAt ? daysUntil(endsAt, now) : null;

  const cancelAtPeriodEnd = live && user.subscriptionCancelAtPeriodEnd;

  return {
    access,
    phase,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt ? user.trialEndsAt.toISOString() : null,
    periodEnd: user.subscriptionPeriodEnd ? user.subscriptionPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd,
    daysLeft,
    inRenewWindow: daysLeft !== null && daysLeft <= RENEW_WINDOW_DAYS && (phase === 'trial' || phase === 'subscribed' || phase === 'past_due'),
    autoRenews: phase === 'subscribed' && !cancelAtPeriodEnd,
    canSubscribe: phase === 'trial' || phase === 'trial_ended' || phase === 'canceled',
    canRenew: (phase === 'subscribed' || phase === 'past_due') && cancelAtPeriodEnd,
    canManage: !!user.stripeCustomerId,
  };
}

const BILLING_SELECT = {
  role: true,
  billingExempt: true,
  trialEndsAt: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
  subscriptionPeriodEnd: true,
  subscriptionCancelAtPeriodEnd: true,
} as const;

export async function getBillingForUser(userId: string): Promise<BillingInfo | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: BILLING_SELECT });
  return user ? evaluateBilling(user) : null;
}

/** Fail closed: a missing user has no access. */
export async function hasBillingAccess(userId: string): Promise<boolean> {
  const info = await getBillingForUser(userId);
  return info?.access ?? false;
}

export async function getTrialDays(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: TRIAL_DAYS_KEY } });
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_TRIAL_DAYS ? n : DEFAULT_TRIAL_DAYS;
}

export async function setTrialDays(days: number): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: TRIAL_DAYS_KEY },
    create: { key: TRIAL_DAYS_KEY, value: String(days) },
    update: { value: String(days) },
  });
}

/** Trial end for an account created right now, using the admin-configured length. */
export async function trialEndsAtForNewUser(from: Date = new Date()): Promise<Date> {
  const days = await getTrialDays();
  return new Date(from.getTime() + days * DAY_MS);
}
