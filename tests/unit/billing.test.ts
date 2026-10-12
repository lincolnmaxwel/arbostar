import { describe, it, expect } from 'vitest';
import { evaluateBilling, RENEW_WINDOW_DAYS, type BillingUserFields } from '@/lib/billing';

const NOW = new Date('2026-10-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

function user(over: Partial<BillingUserFields> = {}): BillingUserFields {
  return {
    role: 'staff',
    billingExempt: false,
    trialEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionPeriodEnd: null,
    subscriptionCancelAtPeriodEnd: false,
    ...over,
  };
}

describe('evaluateBilling', () => {
  it('never gates admins or exempt users', () => {
    expect(evaluateBilling(user({ role: 'admin', trialEndsAt: inDays(-30) }), NOW)).toMatchObject({ access: true, phase: 'exempt' });
    expect(evaluateBilling(user({ billingExempt: true, trialEndsAt: inDays(-30) }), NOW)).toMatchObject({ access: true, phase: 'exempt' });
  });

  it('treats a row with no trial window and no subscription as not billed (legacy)', () => {
    expect(evaluateBilling(user(), NOW)).toMatchObject({ access: true, phase: 'exempt' });
  });

  it('gives access during the trial and counts the days left', () => {
    const info = evaluateBilling(user({ trialEndsAt: inDays(12) }), NOW);
    expect(info).toMatchObject({ access: true, phase: 'trial', daysLeft: 12, inRenewWindow: false, canSubscribe: true });
  });

  it('flags the renew window in the last 10 days of the trial', () => {
    const info = evaluateBilling(user({ trialEndsAt: inDays(RENEW_WINDOW_DAYS) }), NOW);
    expect(info.inRenewWindow).toBe(true);
    expect(info.daysLeft).toBe(10);
  });

  it('locks the account once the trial is over and nothing was bought', () => {
    const info = evaluateBilling(user({ trialEndsAt: inDays(-1) }), NOW);
    expect(info).toMatchObject({ access: false, phase: 'trial_ended', canSubscribe: true, canRenew: false });
  });

  it('keeps access for active and trialing subscriptions and shows auto-renewal', () => {
    for (const status of ['active', 'trialing']) {
      const info = evaluateBilling(
        user({
          trialEndsAt: inDays(-5),
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          subscriptionStatus: status,
          subscriptionPeriodEnd: inDays(20),
        }),
        NOW,
      );
      expect(info).toMatchObject({ access: true, phase: 'subscribed', autoRenews: true, canRenew: false, canSubscribe: false, daysLeft: 20 });
    }
  });

  it('offers Renew when a cancellation is scheduled, and opens the renew window at 10 days', () => {
    const info = evaluateBilling(
      user({
        trialEndsAt: inDays(-40),
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'active',
        subscriptionPeriodEnd: inDays(9),
        subscriptionCancelAtPeriodEnd: true,
      }),
      NOW,
    );
    expect(info).toMatchObject({ access: true, canRenew: true, autoRenews: false, inRenewWindow: true, daysLeft: 9 });
  });

  it('keeps past_due accounts open (Stripe is still retrying) but flags the payment issue', () => {
    const info = evaluateBilling(
      user({
        trialEndsAt: inDays(-40),
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'past_due',
        subscriptionPeriodEnd: inDays(-1),
      }),
      NOW,
    );
    expect(info).toMatchObject({ access: true, phase: 'past_due', canSubscribe: false });
  });

  it('locks a canceled subscription and lets the user subscribe again', () => {
    const info = evaluateBilling(
      user({
        trialEndsAt: inDays(-40),
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'canceled',
        subscriptionPeriodEnd: inDays(-2),
      }),
      NOW,
    );
    expect(info).toMatchObject({ access: false, phase: 'canceled', canSubscribe: true, canManage: true });
  });

  it('falls back to a still-running trial after a canceled subscription', () => {
    const info = evaluateBilling(
      user({
        trialEndsAt: inDays(4),
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'canceled',
      }),
      NOW,
    );
    expect(info).toMatchObject({ access: true, phase: 'trial' });
  });
});
