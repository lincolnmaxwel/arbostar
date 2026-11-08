import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('@/lib/email', () => ({ sendSignupApprovedEmail: vi.fn().mockResolvedValue(undefined) }));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { sendSignupApprovedEmail } from '@/lib/email';
import { GET } from '@/app/api/admin/signup-requests/route';
import { POST as approve } from '@/app/api/admin/signup-requests/[id]/approve/route';
import { POST as deny } from '@/app/api/admin/signup-requests/[id]/deny/route';
import { DELETE as unblock } from '@/app/api/admin/blocked-emails/[id]/route';
import { hashSignupToken, signupExpiry } from '@/lib/signups';
import { TERMS_VERSION } from '@/lib/legal';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;
const approvedMail = vi.mocked(sendSignupApprovedEmail);

describe('admin sign-up approval queue', () => {
  let adminId: string;
  let staffId: string;
  const emails: string[] = [];
  const userIds: string[] = [];

  async function queued(verified = true) {
    const email = `queue-${randomUUID()}@example.com`;
    emails.push(email);
    return prisma.pendingSignup.create({
      data: {
        email,
        name: 'Queue Person',
        phone: '(555) 123-4567',
        referral: 'Referred by John Smith',
        passwordHash: await bcrypt.hash('Queue-pass1', 4),
        tokenHash: hashSignupToken(randomUUID()),
        termsVersion: TERMS_VERSION,
        expiresAt: signupExpiry(),
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
  }

  type Handler = (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
  const call = (fn: Handler, id: string, body?: unknown) =>
    fn(new Request('http://localhost/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }), {
      params: { id },
    });

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    const staff = await prisma.user.create({
      data: { name: 'Staff', email: `staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    adminId = admin.id;
    staffId = staff.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.pendingSignup.deleteMany({ where: { email: { in: emails } } });
    await prisma.blockedEmail.deleteMany({ where: { email: { in: emails } } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds, adminId, staffId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    approvedMail.mockClear();
    sessionMock.mockResolvedValue({ user: { id: adminId } });
  });

  it('is admin only', async () => {
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    expect((await GET()).status).toBe(403);
    const row = await queued();
    expect((await call(approve, row.id, { trialDays: 10 })).status).toBe(403);
    expect((await call(deny, row.id, { reason: 'x' })).status).toBe(403);
  });

  it('lists only email-confirmed, undecided requests with all their details', async () => {
    const waiting = await queued(true);
    const unconfirmed = await queued(false);
    const body = await (await GET()).json();
    const ids = body.pending.map((p: { id: string }) => p.id);
    expect(ids).toContain(waiting.id);
    expect(ids).not.toContain(unconfirmed.id);
    const found = body.pending.find((p: { id: string }) => p.id === waiting.id);
    expect(found).toMatchObject({ phone: '(555) 123-4567', referral: 'Referred by John Smith', email: waiting.email });
  });

  it('approve creates the account with the chosen trial and emails the person', async () => {
    const row = await queued();
    const res = await call(approve, row.id, { trialDays: 30, priceCents: null });
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: row.email }, include: { featureFlags: true } });
    userIds.push(user.id);
    expect(user.status).toBe('active');
    expect(user.role).toBe('staff');
    expect(await bcrypt.compare('Queue-pass1', user.passwordHash)).toBe(true);
    const days = (user.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(user.customPriceId).toBeNull();
    expect(user.featureFlags.filter((f) => f.enabled)).toHaveLength(4);
    expect(approvedMail).toHaveBeenCalledTimes(1);

    // Already handled: a second approval is refused.
    expect((await call(approve, row.id, { trialDays: 30 })).status).toBe(404);
  });

  it('rejects an invalid trial length or price', async () => {
    const row = await queued();
    expect((await call(approve, row.id, { trialDays: -1 })).status).toBe(400);
    expect((await call(approve, row.id, { trialDays: 'x' })).status).toBe(400);
    expect((await call(approve, row.id, { trialDays: 10, priceCents: 1 })).status).toBe(400);
    expect(await prisma.user.count({ where: { email: row.email } })).toBe(0);
  });

  it('deny blocks the email; removing it from the list lets the person ask again', async () => {
    const row = await queued();
    expect((await call(deny, row.id, { reason: '  ' })).status).toBe(400);
    expect(await prisma.pendingSignup.count({ where: { email: row.email } })).toBe(1);
    expect((await call(deny, row.id, { reason: 'Not a tree service' })).status).toBe(200);
    expect(await prisma.pendingSignup.count({ where: { email: row.email } })).toBe(0);
    const blocked = await prisma.blockedEmail.findUniqueOrThrow({ where: { email: row.email } });
    expect(blocked.referral).toBe('Referred by John Smith');
    expect(blocked.reason).toBe('Not a tree service');

    const list = await (await GET()).json();
    expect(list.blocked.map((b: { id: string }) => b.id)).toContain(blocked.id);

    const res = await unblock(new Request('http://localhost/x', { method: 'DELETE' }), { params: { id: blocked.id } });
    expect(res.status).toBe(200);
    expect(await prisma.blockedEmail.count({ where: { email: row.email } })).toBe(0);
  });
});
