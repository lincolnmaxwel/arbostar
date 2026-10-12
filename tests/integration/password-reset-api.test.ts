import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('@/lib/email', () => ({ sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined) }));

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/email';
import { POST as forgot } from '@/app/api/password/forgot/route';
import { POST as reset } from '@/app/api/password/reset/[token]/route';
import { RESET_COOLDOWN_MINUTES } from '@/lib/passwordReset';

const sendMock = vi.mocked(sendPasswordResetEmail);
const stamp = Date.now();
const email = `reset-${stamp}@example.com`;
const blockedEmail = `reset-blocked-${stamp}@example.com`;
let userId = '';

function forgotReq(value: unknown) {
  return forgot(
    new Request('http://localhost/api/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: value }),
    }),
  );
}

function tokenFromLastEmail(): string {
  const { resetUrl } = sendMock.mock.calls[sendMock.mock.calls.length - 1][0];
  return resetUrl.split('/reset-password/')[1];
}

function resetReq(token: string, password: string) {
  return reset(
    new Request(`http://localhost/api/password/reset/${token}`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
    { params: { token } },
  );
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash('old-password', 4);
  const user = await prisma.user.create({
    data: { name: 'Reset Tester', email, passwordHash, role: 'staff', trialEndsAt: null },
  });
  userId = user.id;
  await prisma.user.create({
    data: { name: 'Blocked', email: blockedEmail, passwordHash, role: 'staff', status: 'blocked' },
  });
});

beforeEach(() => {
  sendMock.mockClear();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: userId } });
  await prisma.user.deleteMany({ where: { email: { in: [email, blockedEmail] } } });
});

describe('forgot / reset password', () => {
  it('sends a link once, rate limits to one per window, and answers identically', async () => {
    const first = await forgotReq(email.toUpperCase());
    expect(first.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const firstBody = await first.json();

    const second = await forgotReq(email);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Once the cooldown passes, a new link can be requested.
    await prisma.passwordReset.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - (RESET_COOLDOWN_MINUTES + 1) * 60 * 1000) },
    });
    await forgotReq(email);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('does not reveal unknown or blocked accounts and sends nothing for them', async () => {
    const unknown = await forgotReq(`nobody-${stamp}@example.com`);
    const blocked = await forgotReq(blockedEmail);
    expect(unknown.status).toBe(200);
    expect(blocked.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    expect((await forgotReq('not-an-email')).status).toBe(400);
    expect((await forgotReq(42)).status).toBe(400);
  });

  it('resets the password once and burns the link', async () => {
    await prisma.passwordReset.deleteMany({ where: { userId } });
    await forgotReq(email);
    const token = tokenFromLastEmail();

    expect((await resetReq(token, 'abc')).status).toBe(400);

    const ok = await resetReq(token, 'brand-new-password');
    expect(ok.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare('brand-new-password', user.passwordHash)).toBe(true);

    expect((await resetReq(token, 'another-password')).status).toBe(410);
    expect((await resetReq('x'.repeat(43), 'another-password')).status).toBe(404);
  });

  it('refuses an expired link', async () => {
    await prisma.passwordReset.deleteMany({ where: { userId } });
    await forgotReq(email);
    const token = tokenFromLastEmail();
    await prisma.passwordReset.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await resetReq(token, 'brand-new-password')).status).toBe(410);
  });
});
