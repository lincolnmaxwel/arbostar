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
      process.env.STRIPE_SECRET_KEY = prevKey;
      process.env.STRIPE_PRICE_ID = prevPrice;
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
      process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
      process.env.STRIPE_SECRET_KEY = prevKey;
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
});
