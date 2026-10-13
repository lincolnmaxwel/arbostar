import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('@/lib/email', () => ({ sendSignupVerificationEmail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from '@/lib/db';
import { sendSignupVerificationEmail } from '@/lib/email';
import { POST as signup } from '@/app/api/signup/route';
import { POST as verify } from '@/app/api/signup/verify/[token]/route';
import { hashSignupToken, SIGNUP_COOLDOWN_MINUTES } from '@/lib/signups';
import { TERMS_VERSION } from '@/lib/legal';

const sendMock = vi.mocked(sendSignupVerificationEmail);

const emails: string[] = [];
const userIds: string[] = [];

function signupReq(body: Record<string, unknown>) {
  return signup(
    new Request('http://localhost/api/signup', { method: 'POST', body: JSON.stringify(body) }),
  );
}

function tokenFromLastEmail(): string {
  const call = sendMock.mock.calls[sendMock.mock.calls.length - 1][0];
  return call.verifyUrl.split('/signup/verify/')[1];
}

function verifyReq(token: string, body: Record<string, unknown>) {
  return verify(
    new Request(`http://localhost/api/signup/verify/${token}`, { method: 'POST', body: JSON.stringify(body) }),
    { params: { token } },
  );
}

async function doSignup(email: string) {
  const res = await signupReq({ name: 'New Person', email, acceptTerms: true });
  expect(res.status).toBe(200);
  return tokenFromLastEmail();
}

describe('public sign-up', () => {
  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('existing-pass', 4);
    // A pre-existing user whose address must never receive verification mail.
    const email = `existing-${randomUUID()}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({
      data: { name: 'Existing User', email, passwordHash, role: 'staff', trialEndsAt: null },
    });
    userIds.push(user.id);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: userIds } } });
    await prisma.pendingSignup.deleteMany({ where: { email: { in: emails } } });
    await prisma.userFeatureFlag.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  beforeEach(() => {
    sendMock.mockClear();
  });

  it('sends one verification email and answers identically for new, cooldown and existing-user addresses', async () => {
    const email = `new-${randomUUID()}@example.com`;
    emails.push(email);

    const first = await signupReq({ name: 'New Person', email: email.toUpperCase(), acceptTerms: true });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      ok: true,
      message: 'If this email can be used to create an account, a verification link is on its way.',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe(email);

    // The email is lowercased + trimmed before storing, and only the hash of
    // the token is stored, never the raw token.
    const row = await prisma.pendingSignup.findFirstOrThrow({ where: { email } });
    const token = tokenFromLastEmail();
    expect(row.tokenHash).toBe(hashSignupToken(token));
    expect(row.tokenHash).not.toContain(token);

    // Cooldown: a second request within 10 minutes sends nothing.
    const second = await signupReq({ name: 'New Person', email, acceptTerms: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(sendMock).toHaveBeenCalledTimes(1);

    // Once the cooldown passes, a fresh link can be requested.
    await prisma.pendingSignup.updateMany({
      where: { email },
      data: { createdAt: new Date(Date.now() - (SIGNUP_COOLDOWN_MINUTES + 1) * 60 * 1000) },
    });
    await signupReq({ name: 'New Person', email, acceptTerms: true });
    expect(sendMock).toHaveBeenCalledTimes(2);

    // An address that already has an account gets the same answer and no mail.
    const existing = await prisma.user.findFirstOrThrow({ where: { email: { not: '' } } });
    const existingBody = await (await signupReq({ name: 'New Person', email: existing.email, acceptTerms: true })).json();
    expect(existingBody).toEqual(firstBody);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('ignores honeypot submissions entirely', async () => {
    const email = `bot-${randomUUID()}@example.com`;
    const res = await signupReq({ name: 'New Person', email, acceptTerms: true, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: 'If this email can be used to create an account, a verification link is on its way.',
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(await prisma.pendingSignup.count({ where: { email } })).toBe(0);
  });

  it('rejects invalid input', async () => {
    const email = `bad-${randomUUID()}@example.com`;
    expect((await signupReq({ name: 'X', email, acceptTerms: true })).status).toBe(400);
    expect((await signupReq({ name: 'Valid Name', email: 'not-an-email', acceptTerms: true })).status).toBe(400);
    expect((await signupReq({ name: 'Valid Name', email, acceptTerms: false })).status).toBe(400);
    expect((await signupReq({ name: 'Valid Name', email })).status).toBe(400);
    const missingConsent = await signupReq({ name: 'Valid Name', email, acceptTerms: false });
    expect((await missingConsent.json()).error).toBe('You must accept the Terms and Privacy Policy.');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('creates the user with trial, terms fields and all features on first verify', async () => {
    const email = `verify-${randomUUID()}@example.com`;
    emails.push(email);
    const token = await doSignup(email);

    const res = await verifyReq(token, { password: 'brand-new-pass', name: 'Chosen Name' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, email });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { featureFlags: true },
    });
    userIds.push(user.id);
    expect(user.name).toBe('Chosen Name');
    expect(user.role).toBe('staff');
    expect(user.status).toBe('active');
    expect(user.trialEndsAt).not.toBeNull();
    expect(user.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());
    expect(user.termsAcceptedAt).not.toBeNull();
    expect(user.termsVersion).toBe(TERMS_VERSION);
    expect(
      user.featureFlags.filter((f) => f.enabled).map((f) => f.feature).sort(),
    ).toEqual(['clients_crm', 'invoices', 'quotes', 'timesheet']);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'self-signup', entityId: user.id },
    });
    expect(audit.actorId).toBe(user.id);

    const pending = await prisma.pendingSignup.findUniqueOrThrow({ where: { tokenHash: hashSignupToken(token) } });
    expect(pending.acceptedAt).not.toBeNull();
  });

  it('a link works exactly once; invalid tokens are 404; expired tokens are 410', async () => {
    const email = `once-${randomUUID()}@example.com`;
    emails.push(email);
    const token = await doSignup(email);

    expect((await verifyReq(token, { password: 'long-enough' })).status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);

    const second = await verifyReq(token, { password: 'another-pass' });
    expect(second.status).toBe(410);

    const invalid = await verifyReq('x'.repeat(43), { password: 'long-enough' });
    expect(invalid.status).toBe(404);

    const expiredEmail = `expired-${randomUUID()}@example.com`;
    emails.push(expiredEmail);
    const expiredToken = await doSignup(expiredEmail);
    await prisma.pendingSignup.updateMany({
      where: { email: expiredEmail },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await verifyReq(expiredToken, { password: 'long-enough' })).status).toBe(410);
    expect(await prisma.user.findUnique({ where: { email: expiredEmail } })).toBeNull();
  });

  it('rejects short passwords and verifies with the pending name when none is sent', async () => {
    const email = `short-${randomUUID()}@example.com`;
    emails.push(email);
    const token = await doSignup(email);

    expect((await verifyReq(token, { password: '123' })).status).toBe(400);

    expect((await verifyReq(token, { password: 'long-enough' })).status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);
    expect(user.name).toBe('New Person');
  });

  it('answers 409 when a real user exists for the address meanwhile', async () => {
    const email = `race-${randomUUID()}@example.com`;
    emails.push(email);
    const token = await doSignup(email);

    const passwordHash = await bcrypt.hash('other-pass', 4);
    const winner = await prisma.user.create({
      data: { name: 'Race Winner', email, passwordHash, role: 'staff', trialEndsAt: null },
    });
    userIds.push(winner.id);

    const res = await verifyReq(token, { password: 'long-enough' });
    expect(res.status).toBe(409);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('blocks a sign-up for an existing account stored with different casing', async () => {
    // Admin-created users keep the email casing as typed, so the duplicate
    // check must be case-insensitive.
    const storedEmail = `MixedCase-${randomUUID()}@Example.COM`;
    const passwordHash = await bcrypt.hash('mixed-pass', 4);
    const user = await prisma.user.create({
      data: { name: 'Mixed Case', email: storedEmail, passwordHash, role: 'staff', trialEndsAt: null },
    });
    userIds.push(user.id);

    const res = await signupReq({ name: 'New Person', email: storedEmail.toLowerCase(), acceptTerms: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: 'If this email can be used to create an account, a verification link is on its way.',
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(await prisma.pendingSignup.count({ where: { email: storedEmail.toLowerCase() } })).toBe(0);
  });

  it('deletes the pending row and still answers 200 when the email cannot be sent', async () => {
    const email = `fail-${randomUUID()}@example.com`;
    emails.push(email);
    sendMock.mockRejectedValueOnce(new Error('smtp down'));

    const res = await signupReq({ name: 'New Person', email, acceptTerms: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      message: 'If this email can be used to create an account, a verification link is on its way.',
    });
    expect(await prisma.pendingSignup.count({ where: { email } })).toBe(0);
  });
});