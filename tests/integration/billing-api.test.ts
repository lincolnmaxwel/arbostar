import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock('@/lib/email', () => ({
  sendInviteEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { isFeatureEnabled, getFeatureFlags } from '@/lib/features';
import { syncSubscription } from '@/lib/stripe';
import { getTrialDays, setTrialDays, TRIAL_DAYS_KEY } from '@/lib/billing';
import { GET as getBilling } from '@/app/api/billing/route';
import { POST as checkout } from '@/app/api/billing/checkout/route';
import { POST as webhook } from '@/app/api/stripe/webhook/route';
import { GET as getSettings, PATCH as patchSettings } from '@/app/api/admin/billing-settings/route';
import { PATCH as patchUser } from '@/app/api/admin/users/[id]/route';
import { GET as listSubscriptions } from '@/app/api/admin/subscriptions/route';
import { DELETE as deleteSubscription } from '@/app/api/admin/users/[id]/subscription/route';

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;
const DAY = 24 * 60 * 60 * 1000;

describe('billing: access gate, webhook and admin settings', () => {
  let adminId: string;
  let lockedId: string;
  let trialId: string;
  let paidId: string;
  const ids: string[] = [];
  let originalTrialDays: string | null = null;

  async function makeUser(over: Record<string, unknown>) {
    const u = await prisma.user.create({
      data: {
        name: 'Billing Test',
        email: `billing-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        featureFlags: { create: [{ feature: 'quotes', enabled: true }] },
        ...over,
      },
    });
    ids.push(u.id);
    return u;
  }

  beforeAll(async () => {
    originalTrialDays = (await prisma.appSetting.findUnique({ where: { key: TRIAL_DAYS_KEY } }))?.value ?? null;
    adminId = (await makeUser({ role: 'admin' })).id;
    lockedId = (await makeUser({ trialEndsAt: new Date(Date.now() - DAY) })).id;
    trialId = (await makeUser({ trialEndsAt: new Date(Date.now() + 5 * DAY) })).id;
    paidId = (
      await makeUser({
        trialEndsAt: new Date(Date.now() - 30 * DAY),
        stripeCustomerId: `cus_${randomUUID()}`,
        stripeSubscriptionId: `sub_${randomUUID()}`,
        subscriptionStatus: 'active',
        subscriptionPeriodEnd: new Date(Date.now() + 20 * DAY),
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    if (originalTrialDays === null) await prisma.appSetting.deleteMany({ where: { key: TRIAL_DAYS_KEY } });
    else await setTrialDays(Number(originalTrialDays));
  });

  beforeEach(() => {
    sessionMock.mockReset();
    sessionMock.mockResolvedValue({ user: { id: adminId } });
  });

  it('switches features off for a lapsed trial and keeps them for trial / paid users', async () => {
    expect(await isFeatureEnabled(lockedId, 'quotes')).toBe(false);
    expect((await getFeatureFlags(lockedId)).quotes).toBe(false);

    expect(await isFeatureEnabled(trialId, 'quotes')).toBe(true);
    expect(await isFeatureEnabled(paidId, 'quotes')).toBe(true);
    // Admins are never gated.
    expect(await isFeatureEnabled(adminId, 'quotes')).toBe(true);
  });

  it('GET /api/billing reports the signed-in user state (never the viewed account)', async () => {
    sessionMock.mockResolvedValue({ user: { id: lockedId } });
    const res = await getBilling();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.billing).toMatchObject({ phase: 'trial_ended', access: false, canSubscribe: true });
  });

  it('checkout refuses accounts that need no subscription or already have one', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    const prevKey = process.env.STRIPE_SECRET_KEY;
    const prevPrice = process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_PRICE_ID = 'price_dummy';
    try {
      expect((await checkout()).status).toBe(400);
      sessionMock.mockResolvedValue({ user: { id: paidId } });
      expect((await checkout()).status).toBe(409);
    } finally {
      restoreEnv('STRIPE_SECRET_KEY', prevKey);
      restoreEnv('STRIPE_PRICE_ID', prevPrice);
    }
  });

  it('syncSubscription mirrors Stripe state onto the user, matched by metadata.userId', async () => {
    const periodEnd = Math.floor((Date.now() + 25 * DAY) / 1000);
    const sub = {
      id: `sub_${randomUUID()}`,
      customer: `cus_${randomUUID()}`,
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: null,
      metadata: { userId: lockedId },
      items: { data: [{ current_period_end: periodEnd }] },
    } as unknown as Stripe.Subscription;

    expect(await syncSubscription(sub)).toBe(lockedId);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: lockedId } });
    expect(row).toMatchObject({
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer,
      subscriptionStatus: 'active',
      subscriptionCancelAtPeriodEnd: true,
    });
    expect(row.subscriptionPeriodEnd?.getTime()).toBe(periodEnd * 1000);
    // The lapsed user is back in business.
    expect(await isFeatureEnabled(lockedId, 'quotes')).toBe(true);

    // Unknown customer and no metadata: nothing to update.
    expect(
      await syncSubscription({ ...sub, customer: 'cus_unknown', metadata: {} } as unknown as Stripe.Subscription),
    ).toBeNull();
  });

  it('webhook rejects missing/invalid signatures and accepts a correctly signed event', async () => {
    const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const prevKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    try {
      const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'ping.unhandled', data: { object: {} } });

      const noSig = await webhook(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: payload }));
      expect(noSig.status).toBe(400);

      const badSig = await webhook(
        new Request('http://localhost/api/stripe/webhook', {
          method: 'POST',
          body: payload,
          headers: { 'stripe-signature': 't=1,v1=deadbeef' },
        }),
      );
      expect(badSig.status).toBe(400);

      const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
        payload,
        secret: 'whsec_test_secret',
      });
      const ok = await webhook(
        new Request('http://localhost/api/stripe/webhook', {
          method: 'POST',
          body: payload,
          headers: { 'stripe-signature': header },
        }),
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ received: true });
    } finally {
      restoreEnv('STRIPE_WEBHOOK_SECRET', prevSecret);
      restoreEnv('STRIPE_SECRET_KEY', prevKey);
    }
  });

  it('admin configures the trial length (validated, admin only)', async () => {
    const patch = (trialDays: unknown) =>
      patchSettings(new Request('http://localhost/api/admin/billing-settings', { method: 'PATCH', body: JSON.stringify({ trialDays }) }));

    expect((await patch(21)).status).toBe(200);
    expect(await getTrialDays()).toBe(21);
    const got = await (await getSettings()).json();
    expect(got.trialDays).toBe(21);

    expect((await patch(-1)).status).toBe(400);
    expect((await patch(1.5)).status).toBe(400);
    expect((await patch('7')).status).toBe(400);
    expect((await patch(366)).status).toBe(400);

    sessionMock.mockResolvedValue({ user: { id: trialId } });
    expect((await patch(10)).status).toBe(403);
    expect(await getTrialDays()).toBe(21);
  });

  it('admin can exempt a user from billing', async () => {
    const res = await patchUser(
      new Request(`http://localhost/api/admin/users/${lockedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ billingExempt: true }),
      }),
      { params: { id: lockedId } },
    );
    expect(res.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: lockedId } })).billingExempt).toBe(true);

    const bad = await patchUser(
      new Request(`http://localhost/api/admin/users/${lockedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ billingExempt: 'yes' }),
      }),
      { params: { id: lockedId } },
    );
    expect(bad.status).toBe(400);
  });

  it('admin subscriptions overview lists every account with its billing phase', async () => {
    const res = await listSubscriptions();
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(body.subscriptions.map((r: { id: string }) => [r.id, r]));
    expect(byId[trialId]).toMatchObject({ phase: 'trial', access: true });
    expect(byId[paidId]).toMatchObject({ phase: 'subscribed', autoRenews: true });
    expect(byId[adminId]).toMatchObject({ phase: 'exempt', role: 'admin' });
    expect(body.summary.total).toBeGreaterThanOrEqual(4);
    expect(['test', 'live']).toContain(body.stripeMode);

    sessionMock.mockResolvedValue({ user: { id: trialId } });
    expect((await listSubscriptions()).status).toBe(403);
  });

  it('admin can extend a trial, counting from today when it already lapsed', async () => {
    const extend = (id: string, days: unknown) =>
      patchUser(
        new Request(`http://localhost/api/admin/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ extendTrialDays: days }),
        }),
        { params: { id } },
      );

    const before = (await prisma.user.findUniqueOrThrow({ where: { id: trialId } })).trialEndsAt as Date;
    expect((await extend(trialId, 10)).status).toBe(200);
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: trialId } })).trialEndsAt as Date;
    expect(after.getTime() - before.getTime()).toBe(10 * DAY);

    // A lapsed trial restarts from now, not from the old end date.
    const lapsed = await makeUser({ trialEndsAt: new Date(Date.now() - 20 * DAY) });
    expect((await extend(lapsed.id, 7)).status).toBe(200);
    const restarted = (await prisma.user.findUniqueOrThrow({ where: { id: lapsed.id } })).trialEndsAt as Date;
    expect(restarted.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY);
    expect(restarted.getTime()).toBeLessThan(Date.now() + 7.1 * DAY);
    expect(await isFeatureEnabled(lapsed.id, 'quotes')).toBe(true);

    expect((await extend(trialId, 0)).status).toBe(400);
    expect((await extend(trialId, 400)).status).toBe(400);
    expect((await extend(trialId, 'x')).status).toBe(400);
  });

  it('deleting a subscription returns the account to its trial, or to trial-ended when the trial is over', async () => {
    const sub = (id: string, status = 'active') => ({
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      subscriptionStatus: status,
      subscriptionPeriodEnd: new Date(Date.now() + 20 * DAY),
      ...(id ? {} : {}),
    });
    const remove = (id: string) =>
      deleteSubscription(new Request(`http://localhost/api/admin/users/${id}/subscription`, { method: 'DELETE' }), {
        params: { id },
      });

    // Still inside the trial window -> back on trial.
    const inTrial = await makeUser({ trialEndsAt: new Date(Date.now() + 8 * DAY), ...sub('a') });
    const res1 = await remove(inTrial.id);
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({ phase: 'trial', access: true });
    const row1 = await prisma.user.findUniqueOrThrow({ where: { id: inTrial.id } });
    expect(row1).toMatchObject({
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      subscriptionPeriodEnd: null,
      subscriptionCancelAtPeriodEnd: false,
    });
    expect(row1.stripeCustomerId).not.toBeNull();

    // Trial already over -> locked.
    const expired = await makeUser({ trialEndsAt: new Date(Date.now() - 3 * DAY), ...sub('b') });
    const res2 = await remove(expired.id);
    expect(await res2.json()).toMatchObject({ phase: 'trial_ended', access: false });
    expect(await isFeatureEnabled(expired.id, 'quotes')).toBe(false);

    // Nothing to delete, unknown user, and non-admins are refused.
    expect((await remove(inTrial.id)).status).toBe(409);
    expect((await remove(randomUUID())).status).toBe(404);
    sessionMock.mockResolvedValue({ user: { id: trialId } });
    expect((await remove(expired.id)).status).toBe(403);
  });

  it('a late "canceled" event for a deleted subscription does not bring the canceled state back', async () => {
    const user = await makeUser({ trialEndsAt: new Date(Date.now() - DAY), stripeCustomerId: `cus_${randomUUID()}` });
    const stale = {
      id: `sub_${randomUUID()}`,
      customer: user.stripeCustomerId,
      status: 'canceled',
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { userId: user.id },
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] },
    } as unknown as Stripe.Subscription;

    expect(await syncSubscription(stale)).toBeNull();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.stripeSubscriptionId).toBeNull();
    expect(row.subscriptionStatus).toBeNull();

    // A brand-new live subscription still goes through.
    const fresh = { ...stale, id: `sub_${randomUUID()}`, status: 'active' } as unknown as Stripe.Subscription;
    expect(await syncSubscription(fresh)).toBe(user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).subscriptionStatus).toBe('active');
  });

  it('admin sets the trial end to an exact date, shortening or extending it', async () => {
    const user = await makeUser({ trialEndsAt: new Date(Date.now() + 10 * DAY) });
    const setEnd = (trialEndsAt: unknown, extra: Record<string, unknown> = {}) =>
      patchUser(
        new Request(`http://localhost/api/admin/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ trialEndsAt, ...extra }),
        }),
        { params: { id: user.id } },
      );

    // Shorten to a past moment: the trial is over and the account locks.
    const past = new Date(Date.now() - 2 * DAY);
    expect((await setEnd(past.toISOString())).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).trialEndsAt?.getTime()).toBe(past.getTime());
    expect(await isFeatureEnabled(user.id, 'quotes')).toBe(false);

    // Extend to a specific future date: access is back.
    const future = new Date(Date.now() + 40 * DAY);
    expect((await setEnd(future.toISOString())).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).trialEndsAt?.getTime()).toBe(future.getTime());
    expect(await isFeatureEnabled(user.id, 'quotes')).toBe(true);

    // Invalid input.
    expect((await setEnd('not-a-date')).status).toBe(400);
    expect((await setEnd(12345)).status).toBe(400);
    expect((await setEnd(new Date(Date.now() + 10 * 365 * DAY).toISOString())).status).toBe(400);
    expect((await setEnd(future.toISOString(), { extendTrialDays: 5 })).status).toBe(400);
  });
});
