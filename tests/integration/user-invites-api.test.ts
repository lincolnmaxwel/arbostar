import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return { ...actual, getServerSession: vi.fn() };
});
vi.mock('@/lib/email', () => ({ sendInviteEmail: vi.fn().mockResolvedValue(undefined) }));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { sendInviteEmail } from '@/lib/email';
import { POST as createUser } from '@/app/api/admin/users/route';
import { GET as listInvites } from '@/app/api/admin/invites/route';
import { DELETE as revokeInvite } from '@/app/api/admin/invites/[id]/route';
import { POST as resendInvite } from '@/app/api/admin/invites/[id]/resend/route';
import { POST as acceptInvite } from '@/app/api/invite/[token]/accept/route';
import { DELETE as deleteUser } from '@/app/api/admin/users/[id]/route';
import { hashInviteToken } from '@/lib/invites';

const sessionMock = getServerSession as unknown as ReturnType<typeof vi.fn>;
const sendMock = vi.mocked(sendInviteEmail);

function tokenFromLastEmail(): string {
  const call = sendMock.mock.calls[sendMock.mock.calls.length - 1][0];
  return call.acceptUrl.split('/invite/')[1];
}

describe('user invitations', () => {
  let adminId: string;
  let staffId: string;
  const emails: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { name: 'Invite Admin', email: `inv-admin-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    adminId = admin.id;
    const staff = await prisma.user.create({
      data: { name: 'Invite Staff', email: `inv-staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    staffId = staff.id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.userInvite.deleteMany({ where: { email: { in: emails } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: adminId }, { entityId: { in: ids } }] } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [...ids, adminId, staffId] } } });
  });

  beforeEach(() => {
    sessionMock.mockReset();
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    sendMock.mockClear();
  });

  async function invite(email: string, extra: Record<string, unknown> = {}) {
    emails.push(email);
    return createUser(
      new Request('http://localhost/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Invited Person',
          email,
          sendInvite: true,
          role: 'staff',
          hourlyRate: 30,
          features: ['quotes', 'invoices'],
          ...extra,
        }),
      }),
    );
  }

  function accept(token: string, body: Record<string, unknown>) {
    return acceptInvite(
      new Request(`http://localhost/api/invite/${token}/accept`, { method: 'POST', body: JSON.stringify(body) }),
      { params: { token } },
    );
  }

  it('creates an invite and emails a one-time link, without creating a user yet', async () => {
    const email = `invitee-${randomUUID()}@example.com`;
    const res = await invite(email);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailSent).toBe(true);
    expect(body.inviteUrl).toBeUndefined();

    expect(sendMock).toHaveBeenCalledTimes(1);
    const mail = sendMock.mock.calls[0][0];
    expect(mail.to).toBe(email);
    expect(mail.acceptUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    const row = await prisma.userInvite.findFirstOrThrow({ where: { email } });
    // Only the hash is stored, never the raw token.
    expect(row.tokenHash).toBe(hashInviteToken(tokenFromLastEmail()));
    expect(row.tokenHash).not.toContain(tokenFromLastEmail());
  });

  it('requires an admin session and rejects an existing user email', async () => {
    sessionMock.mockResolvedValue({ user: { id: staffId } });
    expect((await invite(`x-${randomUUID()}@example.com`)).status).toBe(403);

    sessionMock.mockResolvedValue({ user: { id: adminId } });
    const existing = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect((await invite(existing.email)).status).toBe(409);
  });

  it('accepting creates an active user with the invited role, rate, features and chosen password', async () => {
    const email = `accept-${randomUUID()}@example.com`;
    await invite(email, { role: 'admin' });
    const token = tokenFromLastEmail();

    const res = await accept(token, { password: 'My-new-pass1', name: 'Real Name' });
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { featureFlags: true } });
    expect(user.name).toBe('Real Name');
    expect(user.role).toBe('admin');
    expect(user.status).toBe('active');
    expect(Number(user.hourlyRate)).toBe(30);
    expect(await bcrypt.compare('My-new-pass1', user.passwordHash)).toBe(true);
    expect(user.featureFlags.filter((f) => f.enabled).map((f) => f.feature).sort()).toEqual(['invoices', 'quotes']);
  });

  it('a link works exactly once', async () => {
    const email = `once-${randomUUID()}@example.com`;
    await invite(email);
    const token = tokenFromLastEmail();
    expect((await accept(token, { password: 'First-pass1' })).status).toBe(201);
    const second = await accept(token, { password: 'Second-pass1' });
    expect(second.status).toBe(410);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await bcrypt.compare('First-pass1', user.passwordHash)).toBe(true);
  });

  it('rejects short passwords, unknown tokens and expired invites', async () => {
    const email = `bad-${randomUUID()}@example.com`;
    await invite(email);
    const token = tokenFromLastEmail();

    expect((await accept(token, { password: '123' })).status).toBe(400);
    expect((await accept('x'.repeat(43), { password: 'Long-enough1' })).status).toBe(404);

    await prisma.userInvite.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await accept(token, { password: 'Long-enough1' })).status).toBe(410);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('a new invite for the same email replaces the pending one', async () => {
    const email = `replace-${randomUUID()}@example.com`;
    await invite(email);
    const first = tokenFromLastEmail();
    await invite(email);
    const second = tokenFromLastEmail();
    expect(first).not.toBe(second);
    expect(await prisma.userInvite.count({ where: { email, acceptedAt: null } })).toBe(1);
    expect((await accept(first, { password: 'Long-enough1' })).status).toBe(404);
    expect((await accept(second, { password: 'Long-enough1' })).status).toBe(201);
  });

  it('resend issues a fresh link and invalidates the old one; revoke removes the invite', async () => {
    const email = `resend-${randomUUID()}@example.com`;
    await invite(email);
    const oldToken = tokenFromLastEmail();
    const row = await prisma.userInvite.findFirstOrThrow({ where: { email } });

    const resent = await resendInvite(new Request('http://localhost'), { params: { id: row.id } });
    expect(resent.status).toBe(200);
    const newToken = tokenFromLastEmail();
    expect(newToken).not.toBe(oldToken);
    expect((await accept(oldToken, { password: 'Long-enough1' })).status).toBe(404);

    const list = await (await listInvites()).json();
    expect(list.invites.some((i: { email: string }) => i.email === email)).toBe(true);

    const revoked = await revokeInvite(new Request('http://localhost'), { params: { id: row.id } });
    expect(revoked.status).toBe(200);
    expect((await accept(newToken, { password: 'Long-enough1' })).status).toBe(404);
  });

  it('deleting a user also deletes the invitations addressed to them and those they sent', async () => {
    // Accepted invite addressed to the user.
    const email = `gone-${randomUUID()}@example.com`;
    await invite(email, { role: 'admin' });
    await accept(tokenFromLastEmail(), { password: 'Long-enough1' });
    const gone = await prisma.user.findUniqueOrThrow({ where: { email } });

    // Pending invite sent by that user (they are an admin now).
    sessionMock.mockResolvedValue({ user: { id: gone.id } });
    const sentEmail = `sent-${randomUUID()}@example.com`;
    const sentRes = await invite(sentEmail);
    expect(sentRes.status).toBe(201);

    // Unrelated invite from the main admin must survive.
    sessionMock.mockResolvedValue({ user: { id: adminId } });
    const keepEmail = `keep-${randomUUID()}@example.com`;
    await invite(keepEmail);

    const res = await deleteUser(new Request('http://localhost'), { params: { id: gone.id } });
    expect(res.status).toBe(200);

    expect(await prisma.userInvite.count({ where: { email } })).toBe(0);
    expect(await prisma.userInvite.count({ where: { email: sentEmail } })).toBe(0);
    expect(await prisma.userInvite.count({ where: { email: keepEmail } })).toBe(1);
  });

  it('purges long-expired and long-accepted invitations when a new one is created', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const staleEmail = `stale-${randomUUID()}@example.com`;
    emails.push(staleEmail);
    await prisma.userInvite.create({
      data: { email: staleEmail, name: 'Stale', tokenHash: randomUUID(), expiresAt: old, invitedById: adminId },
    });
    await invite(`trigger-${randomUUID()}@example.com`);
    expect(await prisma.userInvite.count({ where: { email: staleEmail } })).toBe(0);
  });

  it('returns the link to the admin when the email cannot be delivered', async () => {
    sendMock.mockRejectedValueOnce(new Error('smtp down'));
    const res = await invite(`fail-${randomUUID()}@example.com`);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailSent).toBe(false);
    expect(body.inviteUrl).toMatch(/\/invite\//);
  });
});
