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
    expect(body.features.quotes).toBe(false);

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

  it('toggles quotes on and off like any other feature', async () => {
    const on = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'quotes', enabled: true }),
      }) as Request,
      { params: { id: targetId } },
    );
    expect(on.status).toBe(200);
    expect((await on.json()).features.quotes).toBe(true);

    const off = await PATCH(
      new Request('http://localhost/api/admin/users/x/features', {
        method: 'PATCH',
        body: JSON.stringify({ feature: 'quotes', enabled: false }),
      }) as Request,
      { params: { id: targetId } },
    );
    expect(off.status).toBe(200);
    expect((await off.json()).features.quotes).toBe(false);

    const row = await prisma.userFeatureFlag.findUnique({
      where: { userId_feature: { userId: targetId, feature: 'quotes' } },
    });
    expect(row?.enabled).toBe(false);
  });

  it('backfills an enabled quotes flag for a user that predates the quotes feature', async () => {
    const legacy = await prisma.user.create({
      data: { name: 'Legacy User', email: `legacy-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });

    // Same INSERT the 20260905000002_backfill_quotes_feature_flag migration
    // runs, scoped to this test's user so parallel test files' user cleanup
    // can't race the FK check: an existing user with no quotes row must end
    // up with quotes enabled.
    const backfill = `
      INSERT INTO "UserFeatureFlag" ("id", "userId", "feature", "enabled")
      SELECT gen_random_uuid()::text, u."id", 'quotes', true
      FROM "User" u
      WHERE u."id" = '${legacy.id}'
      ON CONFLICT ("userId", "feature") DO NOTHING;
    `;
    await prisma.$executeRawUnsafe(backfill);

    const row = await prisma.userFeatureFlag.findUnique({
      where: { userId_feature: { userId: legacy.id, feature: 'quotes' } },
    });
    expect(row?.enabled).toBe(true);

    // Idempotent: re-running must not duplicate the row.
    await prisma.$executeRawUnsafe(backfill);
    expect(await prisma.userFeatureFlag.count({ where: { userId: legacy.id, feature: 'quotes' } })).toBe(1);

    await prisma.userFeatureFlag.deleteMany({ where: { userId: legacy.id } });
    await prisma.user.delete({ where: { id: legacy.id } });
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