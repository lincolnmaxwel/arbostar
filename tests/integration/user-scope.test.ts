import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

const { cookieGetMock } = vi.hoisted(() => ({ cookieGetMock: vi.fn() }));

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('next/headers', () => ({
  cookies: () => ({ get: cookieGetMock }),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import {
  requireUserScope,
  auditScopedMutation,
  UnauthorizedError,
  VIEW_AS_COOKIE_NAME,
} from '@/lib/userScope';

describe('requireUserScope', () => {
  let adminId: string;
  let staffId: string;
  let targetId: string;
  let inactiveId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Scope Admin', email: `scope-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
    const staff = await prisma.user.create({
      data: { name: 'Scope Staff', email: `scope-staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    staffId = staff.id;
    const target = await prisma.user.create({
      data: { name: 'Scope Target', email: `scope-target-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    targetId = target.id;
    const inactive = await prisma.user.create({
      data: { name: 'Scope Inactive', email: `scope-inactive-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff', status: 'inactive' },
    });
    inactiveId = inactive.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, staffId] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, staffId, targetId, inactiveId] } },
    });
  });

  beforeEach(() => {
    cookieGetMock.mockReset();
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('rejects a missing session', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(requireUserScope()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a non-active actor even with a valid session', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: inactiveId },
    });
    await expect(requireUserScope()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns self scope for staff, ignoring a stale view-as cookie', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: staffId },
    });
    cookieGetMock.mockReturnValue({ value: targetId });
    const scope = await requireUserScope();
    expect(scope).toEqual({
      actorUserId: staffId,
      ownerUserId: staffId,
      isViewAs: false,
    });
  });

  it('returns self scope for an admin when no cookie is present', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: adminId },
    });
    cookieGetMock.mockReturnValue(undefined);
    const scope = await requireUserScope();
    expect(scope.actorUserId).toBe(adminId);
    expect(scope.ownerUserId).toBe(adminId);
    expect(scope.isViewAs).toBe(false);
  });

  it('lets an admin resolve a valid target via the view-as cookie', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: adminId },
    });
    cookieGetMock.mockReturnValue({ value: targetId });
    const scope = await requireUserScope();
    expect(scope.actorUserId).toBe(adminId);
    expect(scope.ownerUserId).toBe(targetId);
    expect(scope.isViewAs).toBe(true);
    expect(scope.targetUserId).toBe(targetId);
  });

  it('falls back to self scope when the admin cookie points at an unknown user', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: adminId },
    });
    cookieGetMock.mockReturnValue({ value: 'does-not-exist' });
    const scope = await requireUserScope();
    expect(scope.ownerUserId).toBe(adminId);
    expect(scope.isViewAs).toBe(false);
  });

  it('reads the documented cookie name', () => {
    expect(VIEW_AS_COOKIE_NAME).toBe('arbostar-view-as-user');
  });
});

describe('auditScopedMutation', () => {
  let adminId: string;
  let targetId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Audit Admin', email: `audit-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
    const target = await prisma.user.create({
      data: { name: 'Audit Target', email: `audit-target-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    targetId = target.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, targetId] } } });
  });

  it('writes an AuditLog row with real actor and target only when viewing as another user', async () => {
    await auditScopedMutation(
      { actorUserId: adminId, ownerUserId: adminId, isViewAs: false },
      'Client',
      'client-1',
      'update',
    );
    expect(await prisma.auditLog.count({ where: { entityId: 'client-1' } })).toBe(0);

    await auditScopedMutation(
      { actorUserId: adminId, ownerUserId: targetId, isViewAs: true, targetUserId: targetId },
      'Client',
      'client-1',
      'update',
    );
    const row = await prisma.auditLog.findFirst({ where: { entityId: 'client-1' } });
    expect(row).not.toBeNull();
    expect(row?.actorId).toBe(adminId);
    expect(row?.targetUserId).toBe(targetId);
    expect(row?.entityType).toBe('Client');
    expect(row?.action).toBe('update');
  });
});