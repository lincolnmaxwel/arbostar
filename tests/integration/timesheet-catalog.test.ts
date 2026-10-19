import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { POST } from '@/app/api/timesheet/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

function post(products: unknown[], clientId: string) {
  return POST(
    new Request('http://localhost/api/timesheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        workDate: '2026-10-10',
        startedAt: '2026-10-10T13:00:00.000Z',
        endedAt: '2026-10-10T15:00:00.000Z',
        description: 'Work',
        products,
      }),
    }) as never,
  );
}

describe('timesheet products also become Services', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Cat',
        email: `cat-${randomUUID()}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        hourlyRate: 40,
        featureFlags: { create: [{ feature: 'timesheet', enabled: true }] },
      },
    });
    userId = user.id;
    clientId = (await prisma.client.create({ data: { userId, name: 'C', email: `c-${randomUUID()}@example.com` } })).id;
  });

  afterAll(async () => {
    await prisma.timesheetProduct.deleteMany({ where: { timesheetEntry: { userId } } });
    await prisma.timesheetEntry.deleteMany({ where: { userId } });
    await prisma.serviceCatalogItem.deleteMany({ where: { userId } });
    await prisma.client.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    sessionMock.mockResolvedValue({ user: { id: userId } });
  });

  it('creates a service with the same fields (price, billing type, unit)', async () => {
    const res = await post(
      [
        { name: 'Mulch', quantity: 2, unitPrice: 12.5, billingType: 'quantity', unit: 'bag' },
        { name: 'Stump grinding', quantity: 1, unitPrice: 90, billingType: 'hourly', unit: 'ignored' },
      ],
      clientId,
    );
    expect(res.status).toBe(201);
    const items = await prisma.serviceCatalogItem.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    expect(items.map((i) => i.name)).toEqual(['Mulch', 'Stump grinding']);
    expect(Number(items[0].defaultPrice)).toBe(12.5);
    expect(items[0].billingType).toBe('quantity');
    expect(items[0].unit).toBe('bag');
    expect(items[1].billingType).toBe('hourly');
    expect(items[1].unit).toBeNull();
  });

  it('does not duplicate or overwrite a service that already exists (any casing)', async () => {
    const res = await post([{ name: 'MULCH', quantity: 1, unitPrice: 99, billingType: 'quantity', unit: 'pallet' }], clientId);
    expect(res.status).toBe(201);
    const mulch = await prisma.serviceCatalogItem.findMany({ where: { userId, name: { equals: 'mulch', mode: 'insensitive' } } });
    expect(mulch).toHaveLength(1);
    expect(Number(mulch[0].defaultPrice)).toBe(12.5);
  });

  it('adds nothing when the row does not say how it is billed', async () => {
    const res = await post([{ name: 'Legacy row', quantity: 1, unitPrice: 5 }], clientId);
    expect(res.status).toBe(201);
    expect(await prisma.serviceCatalogItem.count({ where: { userId, name: 'Legacy row' } })).toBe(0);
  });
});
