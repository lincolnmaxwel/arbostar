import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { PATCH } from '@/app/api/admin/users/[id]/features/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('/api/admin/users/[id]/features', () => {
  let adminId: string;
  let targetId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Flag Admin', email: `flag-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
    const target = await prisma.user.create({
      data: { name: 'Flag Target', email: `flag-target-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    targetId = target.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: targetId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, targetId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    sessionMock.mockResolvedValue({ user: { id: adminId } });
  });

  it('upserts a flag and returns the complete set', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'timesheet', enabled: true }),
      }) as Request,
      { params: { id: targetId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features.timesheet).toBe(true);
    expect(body.features.invoices).toBe(false);
    expect(body.features.clients_crm).toBe(false);

    const res2 = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'timesheet', enabled: false }),
      }) as Request,
      { params: { id: targetId } },
    );
    const body2 = await res2.json();
    expect(body2.features.timesheet).toBe(false);

    const rows = await prisma.userFeatureFlag.findMany({ where: { userId: targetId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);
  });

  it('rejects quotes as a flag', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'quotes', enabled: true }),
      }) as Request,
      { params: { id: targetId } },
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown features and non-boolean enabled', async () => {
    const unknown = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'billing', enabled: true }),
      }) as Request,
      { params: { id: targetId } },
    );
    expect(unknown.status).toBe(400);

    const badEnabled = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'invoices', enabled: 'yes' }),
      }) as Request,
      { params: { id: targetId } },
    );
    expect(badEnabled.status).toBe(400);
  });

  it('returns 404 for an unknown user', async () => {
    const res = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'invoices', enabled: true }),
      }) as Request,
      { params: { id: 'missing' } },
    );
    expect(res.status).toBe(404);
  });
});