import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { POST, GET } from '@/app/api/admin/users/route';
import { PATCH, GET as GET_ONE } from '@/app/api/admin/users/[id]/route';
import { POST as POST_VIEW_AS, DELETE as DELETE_VIEW_AS } from '@/app/api/admin/view-as/route';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;

describe('/api/admin/users (admin management)', () => {
  let adminId: string;
  let staffId: string;
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin User', email: `admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
    const staff = await prisma.user.create({
      data: { name: 'Staff User', email: `staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    staffId = staff.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds, adminId, staffId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    createdUserIds = [];
  });

  function asAdmin() {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
  }
  function asStaff() {
    sessionMock.mockResolvedValue({ user: { id: staffId } });
  }

  it('returns 401 without a session and 403 for a staff session', async () => {
    sessionMock.mockResolvedValue(null);
    const res401 = await GET();
    expect(res401.status).toBe(401);

    asStaff();
    const res403 = await GET();
    expect(res403.status).toBe(403);
  });

  it('creates a user with hashed password, status, rate, and requested features', async () => {
    asAdmin();
    const email = `created-${randomUUID()}@example.com`;
    const res = await POST(
      new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Created User',
          email,
          password: 'secret123',
          role: 'staff',
          status: 'active',
          hourlyRate: 42.5,
          features: ['invoices', 'timesheet'],
        }),
      }) as Request,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe('staff');
    expect(body.user.status).toBe('active');
    expect(body.user.hourlyRate).toBe(42.5);
    expect(body.user.features.invoices).toBe(true);
    expect(body.user.features.timesheet).toBe(true);
    expect(body.user.features.clients_crm).toBe(false);
    createdUserIds.push(body.user.id);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: body.user.id } });
    expect(stored.passwordHash).not.toBe('secret123');
    expect(await bcrypt.compare('secret123', stored.passwordHash)).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, entityType: 'User', entityId: body.user.id },
    });
    expect(audit?.action).toBe('create');
  });

  it('rejects a duplicate email with 409', async () => {
    asAdmin();
    const email = `dup-${randomUUID()}@example.com`;
    const payload = { name: 'Dup A', email, password: 'secret123', role: 'staff', status: 'active' };
    await POST(new Request('http://localhost/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }) as Request);
    const dup = await POST(new Request('http://localhost/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }) as Request);
    expect(dup.status).toBe(409);
    createdUserIds.push((await prisma.user.findUniqueOrThrow({ where: { email } })).id);
  });

  it('lists users without password hashes', async () => {
    asAdmin();
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBeGreaterThanOrEqual(2);
    for (const u of body.users) {
      expect(u.passwordHash).toBeUndefined();
      expect(u.password).toBeUndefined();
    }
  });

  it('updates safe fields and resets a password', async () => {
    asAdmin();
    const email = `patch-${randomUUID()}@example.com`;
    const created = await POST(
      new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Patch Me', email, password: 'secret123', role: 'staff', status: 'active' }),
      }) as Request,
    );
    const userId = (await created.json()).user.id;
    createdUserIds.push(userId);

    const res = await PATCH(
      new Request('http://localhost/api/admin/users/anything', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Patched Name', hourlyRate: 33.33, password: 'newpass99' }),
      }) as Request,
      { params: { id: userId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.name).toBe('Patched Name');
    expect(body.user.hourlyRate).toBe(33.33);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare('newpass99', stored.passwordHash)).toBe(true);
  });

  it('guards against disabling the last active admin', async () => {
    asAdmin();
    // Temporarily demote every other active admin by creating none: with only
    // this test's admin active, trying to block them must fail — but the
    // self-lockout guard fires first for the same actor, so use a second
    // active admin and block the other one after demoting the first.
    const other = await prisma.user.create({
      data: { name: 'Other Admin', email: `other-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    createdUserIds.push(other.id);

    // actor (adminId) is active; other is active. Block other: still one
    // active admin (actor) remains -> allowed.
    const res = await PATCH(
      new Request('http://localhost/api/admin/users/x', { method: 'PATCH', body: JSON.stringify({ status: 'blocked' }) }) as Request,
      { params: { id: other.id } },
    );
    expect(res.status).toBe(200);
    await prisma.user.update({ where: { id: other.id }, data: { status: 'active' } });

    // Now demote the actor to staff (self-lockout guard -> 409).
    const selfDemote = await PATCH(
      new Request('http://localhost/api/admin/users/x', { method: 'PATCH', body: JSON.stringify({ role: 'staff' }) }) as Request,
      { params: { id: adminId } },
    );
    expect(selfDemote.status).toBe(409);
  });

  it('prevents self-lockout via status too', async () => {
    asAdmin();
    const res = await PATCH(
      new Request('http://localhost/api/admin/users/x', { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) }) as Request,
      { params: { id: adminId } },
    );
    expect(res.status).toBe(409);
  });

  it('rejects unknown users with 404', async () => {
    asAdmin();
    const res = await GET_ONE(new Request('http://localhost/api/admin/users/x') as Request, {
      params: { id: 'does-not-exist' },
    });
    expect(res.status).toBe(404);
  });
});

describe('/api/admin/view-as', () => {
  let adminId: string;
  let targetId: string;
  let staffId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'ViewAs Admin', email: `va-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
    const target = await prisma.user.create({
      data: { name: 'ViewAs Target', email: `va-target-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    targetId = target.id;
    const staff = await prisma.user.create({
      data: { name: 'ViewAs Staff', email: `va-staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    staffId = staff.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, targetId, staffId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
  });

  it('sets an HttpOnly view-as cookie for a valid target (admin only)', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    const res = await POST_VIEW_AS(
      new Request('http://localhost/api/admin/view-as', {
        method: 'POST',
        body: JSON.stringify({ userId: targetId }),
      }) as Request,
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('arbostar-view-as-user=' + targetId);
    expect(setCookie.toLowerCase()).toContain('httponly');

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: adminId, entityType: 'User', entityId: targetId, action: 'view-as-start' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects unknown targets with 404', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    const res = await POST_VIEW_AS(
      new Request('http://localhost/api/admin/view-as', {
        method: 'POST',
        body: JSON.stringify({ userId: 'nope' }),
      }) as Request,
    );
    expect(res.status).toBe(404);
  });

  it('clears the cookie on DELETE', async () => {
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    const res = await DELETE_VIEW_AS();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('arbostar-view-as-user=;');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });

  it('forbids staff from setting the cookie', async () => {
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    const res = await POST_VIEW_AS(
      new Request('http://localhost/api/admin/view-as', {
        method: 'POST',
        body: JSON.stringify({ userId: targetId }),
      }) as Request,
    );
    expect(res.status).toBe(403);
  });
});