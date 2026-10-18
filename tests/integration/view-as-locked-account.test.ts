import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'arbostar-view-as-user' && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { getFeatureFlags, isFeatureEnabled } from '@/lib/features';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('admin view-as on an account whose trial has ended', () => {
  let adminId: string;
  let lockedId: string;
  let otherId: string;

  beforeAll(async () => {
    const past = new Date(Date.now() - 5 * 86400000);
    adminId = (await prisma.user.create({ data: { name: 'A', email: `a-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' } })).id;
    const mk = async (tag: string) =>
      (
        await prisma.user.create({
          data: {
            name: tag,
            email: `${tag}-${randomUUID()}@example.com`,
            passwordHash: 'x',
            role: 'staff',
            trialEndsAt: past,
            featureFlags: { create: [{ feature: 'quotes', enabled: true }, { feature: 'invoices', enabled: true }] },
          },
        })
      ).id;
    lockedId = await mk('locked');
    otherId = await mk('other');
  });

  afterAll(async () => {
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: [lockedId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, lockedId, otherId] } } });
  });

  beforeEach(() => {
    cookieValue.current = undefined;
    sessionMock.mockReset();
  });

  it('keeps the lock for the user themself', async () => {
    sessionMock.mockResolvedValue({ user: { id: lockedId } });
    expect(await isFeatureEnabled(lockedId, 'quotes')).toBe(false);
    expect((await getFeatureFlags(lockedId)).quotes).toBe(false);
  });

  it('lets an admin viewing as that user see their enabled features', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieValue.current = lockedId;
    expect(await isFeatureEnabled(lockedId, 'quotes')).toBe(true);
    const flags = await getFeatureFlags(lockedId);
    expect(flags.quotes).toBe(true);
    expect(flags.invoices).toBe(true);
    expect(flags.timesheet).toBe(false); // only what the account has enabled
  });

  it('does not unlock a different locked account than the one being viewed', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    cookieValue.current = lockedId;
    expect(await isFeatureEnabled(otherId, 'quotes')).toBe(false);
  });

  it('ignores a view-as cookie on a staff session', async () => {
    sessionMock.mockResolvedValue({ user: { id: otherId } });
    cookieValue.current = lockedId;
    expect(await isFeatureEnabled(lockedId, 'quotes')).toBe(false);
  });
});
