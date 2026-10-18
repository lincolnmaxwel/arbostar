import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('@/lib/planPrice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/planPrice')>();
  return {
    ...actual,
    // No Stripe in tests: pretend a Price was created/moved.
    setUserPrice: vi.fn(async (_u: unknown, cents: number | null) => ({
      customPriceId: cents === null ? null : `price_test_${cents}`,
      customPriceCents: cents,
    })),
    setDefaultPrice: vi.fn(async () => ({ priceId: 'price_default_test', updated: 2, failed: 0 })),
  };
});

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { setDefaultPrice, setUserPrice } from '@/lib/planPrice';
import { PATCH as patchUser } from '@/app/api/admin/users/[id]/route';
import { PATCH as patchSettings } from '@/app/api/admin/billing-settings/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

function req(body: unknown) {
  return new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

describe('admin plan price (default + per user)', () => {
  let adminId: string;
  let staffId: string;
  const prevKey = process.env.STRIPE_SECRET_KEY;
  const prevPrice = process.env.STRIPE_PRICE_ID;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_PRICE_ID = 'price_dummy';
    adminId = (await prisma.user.create({ data: { name: 'A', email: `a-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' } })).id;
    staffId = (await prisma.user.create({ data: { name: 'S', email: `s-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' } })).id;
  });

  afterAll(async () => {
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevKey;
    if (prevPrice === undefined) delete process.env.STRIPE_PRICE_ID;
    else process.env.STRIPE_PRICE_ID = prevPrice;
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    vi.mocked(setUserPrice).mockClear();
    vi.mocked(setDefaultPrice).mockClear();
    sessionMock.mockResolvedValue({ user: { id: adminId } });
  });

  it('stores a per-user price and clears it back to the default', async () => {
    const res = await patchUser(req({ customPriceCents: 4900 }), { params: { id: staffId } });
    expect(res.status).toBe(200);
    let row = await prisma.user.findUnique({ where: { id: staffId } });
    expect(row?.customPriceCents).toBe(4900);
    expect(row?.customPriceId).toBe('price_test_4900');

    const cleared = await patchUser(req({ customPriceCents: null }), { params: { id: staffId } });
    expect(cleared.status).toBe(200);
    row = await prisma.user.findUnique({ where: { id: staffId } });
    expect(row?.customPriceCents).toBeNull();
    expect(row?.customPriceId).toBeNull();
  });

  it('rejects prices outside $0.50 - $10,000 and fractions of a cent', async () => {
    for (const bad of [0, 10, 49, 1_000_001, 49.5, '49', -5]) {
      const res = await patchUser(req({ customPriceCents: bad }), { params: { id: staffId } });
      expect(res.status).toBe(400);
    }
    expect(setUserPrice).not.toHaveBeenCalled();
  });

  it('sets the default price and reports how many subscriptions moved', async () => {
    const res = await patchSettings(req({ priceCents: 9900, applyToSubscribers: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ priceCents: 9900, updated: 2, failed: 0 });
    expect(setDefaultPrice).toHaveBeenCalledWith(9900, true);

    await patchSettings(req({ priceCents: 9900 }));
    expect(setDefaultPrice).toHaveBeenLastCalledWith(9900, false);
  });

  it('rejects a bad default price and non-admins', async () => {
    expect((await patchSettings(req({ priceCents: 5 }))).status).toBe(400);
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    expect((await patchSettings(req({ priceCents: 9900 }))).status).toBe(403);
    expect((await patchUser(req({ customPriceCents: 4900 }), { params: { id: staffId } })).status).toBe(403);
  });
});
