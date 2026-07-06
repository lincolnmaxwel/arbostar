import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET, PATCH } from '@/app/api/profile/route';
import { POST as changePassword } from '@/app/api/profile/password/route';
import { prisma } from '@/lib/db';

function req(body: unknown) {
  return new Request('http://localhost/api/profile', { method: 'PATCH', body: JSON.stringify(body) }) as any;
}

function passwordReq(body: unknown) {
  return new Request('http://localhost/api/profile/password', { method: 'POST', body: JSON.stringify(body) }) as any;
}

describe('/api/profile', () => {
  let userId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('originalPass123', 10);
    const user = await prisma.user.create({
      data: { name: 'Profile Test', email: `profile-${randomUUID()}@example.com`, passwordHash, role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('GET returns the current user profile with a null notificationEmail by default', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.notificationEmail).toBeNull();
  });

  it('GET returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('PATCH sets notificationEmail', async () => {
    const res = await PATCH(req({ notificationEmail: 'notify@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.notificationEmail).toBe('notify@example.com');

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(updated.notificationEmail).toBe('notify@example.com');
  });

  it('PATCH rejects an invalid email', async () => {
    const res = await PATCH(req({ notificationEmail: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('PATCH with an empty string clears notificationEmail back to null', async () => {
    const res = await PATCH(req({ notificationEmail: '' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.notificationEmail).toBeNull();
  });
});

describe('POST /api/profile/password', () => {
  let userId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('originalPass123', 10);
    const user = await prisma.user.create({
      data: { name: 'Password Test', email: `password-${randomUUID()}@example.com`, passwordHash, role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it('rejects an incorrect current password', async () => {
    const res = await changePassword(passwordReq({ currentPassword: 'wrong', newPassword: 'brandNewPass456' }));
    expect(res.status).toBe(400);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const res = await changePassword(passwordReq({ currentPassword: 'originalPass123', newPassword: 'short' }));
    expect(res.status).toBe(400);
  });

  it('changes the password when the current password is correct', async () => {
    const res = await changePassword(passwordReq({ currentPassword: 'originalPass123', newPassword: 'brandNewPass456' }));
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare('brandNewPass456', updated.passwordHash)).toBe(true);
    expect(await bcrypt.compare('originalPass123', updated.passwordHash)).toBe(false);
  });

  it('returns 401 when unauthenticated', async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await changePassword(passwordReq({ currentPassword: 'x', newPassword: 'brandNewPass456' }));
    expect(res.status).toBe(401);
  });
});
