import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('@/lib/email', () => ({ sendSignupVerificationEmail: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from '@/lib/db';
import { sendSignupVerificationEmail } from '@/lib/email';
import { POST as signup } from '@/app/api/signup/route';
import { POST as verify } from '@/app/api/signup/verify/[token]/route';
import { hashSignupToken, signupExpiry, SIGNUP_COOLDOWN_MINUTES } from '@/lib/signups';
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

function verifyReq(token: string) {
  return verify(new Request(`http://localhost/api/signup/verify/${token}`, { method: 'POST' }), {
    params: { token },
  });
}

const SUCCESS_MESSAGE =
  'Check your email to confirm your address. Your account will be ready as soon as you confirm.';

async function doSignup(email: string, password = 'My-new-pass1') {
  const res = await signupReq({ name: 'New Person', email, password, acceptTerms: true });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, message: SUCCESS_MESSAGE });
  return tokenFromLastEmail();
}

describe('public sign-up', () => {
  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('existing-pass', 4);
    // Addresses that must never receive verification mail: one lowercase, one
    // stored with mixed casing (admin-created users keep the casing as typed).
    for (const email of [`existing-${randomUUID()}@example.com`, `Mixed-${randomUUID()}@Example.COM`]) {
      emails.push(email);
      const user = await prisma.user.create({
        data: { name: 'Existing User', email, passwordHash, role: 'staff', trialEndsAt: null },
      });
      userIds.push(user.id);
    }
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

  it('signs up with a password: stores a bcrypt hash (never the plaintext) and emails a link', async () => {
    const email = `new-${randomUUID()}@example.com`;
    emails.push(email);

    const res = await signupReq({ name: 'New Person', email: email.toUpperCase(), password: 'Super-secret1', acceptTerms: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: SUCCESS_MESSAGE });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe(email);

    // The email is lowercased + trimmed, the password is stored as a bcrypt
    // hash, and only the hash of the token is stored, never the raw token.
    const row = await prisma.pendingSignup.findFirstOrThrow({ where: { email } });
    const token = tokenFromLastEmail();
    expect(row.passwordHash).not.toBeNull();
    expect(row.passwordHash).not.toContain('Super-secret1');
    expect(await bcrypt.compare('Super-secret1', row.passwordHash!)).toBe(true);
    expect(row.termsVersion).toBe(TERMS_VERSION);
    expect(row.tokenHash).toBe(hashSignupToken(token));
    expect(row.tokenHash).not.toContain(token);

    // The pending row is not an account and cannot sign in yet.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('rejects invalid input', async () => {
    const email = `bad-${randomUUID()}@example.com`;
    expect((await signupReq({ name: 'X', email, password: 'Long-enough1', acceptTerms: true })).status).toBe(400);
    expect((await signupReq({ name: 'Valid Name', email: 'not-an-email', password: 'Long-enough1', acceptTerms: true })).status).toBe(400);
    const short = await signupReq({ name: 'Valid Name', email, password: '123', acceptTerms: true });
    expect(short.status).toBe(400);
    expect((await short.json()).error).toContain('at least 6 characters');
    const weak = await signupReq({ name: 'Valid Name', email, password: 'alllowercase', acceptTerms: true });
    expect(weak.status).toBe(400);
    expect((await weak.json()).error).toContain('uppercase');
    expect((await signupReq({ name: 'Valid Name', email, password: 'x'.repeat(201), acceptTerms: true })).status).toBe(400);
    expect((await signupReq({ name: 'Valid Name', email, password: 'Long-enough1', acceptTerms: false })).status).toBe(400);
    const missingConsent = await signupReq({ name: 'Valid Name', email, password: 'Long-enough1' });
    expect(missingConsent.status).toBe(400);
    expect((await missingConsent.json()).error).toBe('You must accept the Terms and Privacy Policy.');
    expect(sendMock).not.toHaveBeenCalled();
    expect(await prisma.pendingSignup.count({ where: { email } })).toBe(0);
  });

  it('ignores honeypot submissions entirely', async () => {
    const email = `bot-${randomUUID()}@example.com`;
    const res = await signupReq({ name: 'New Person', email, password: 'Long-enough1', acceptTerms: true, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: SUCCESS_MESSAGE });
    expect(sendMock).not.toHaveBeenCalled();
    expect(await prisma.pendingSignup.count({ where: { email } })).toBe(0);
  });

  it('answers 409 with code email-exists for an existing account, including mixed-case addresses', async () => {
    const [lower, mixed] = (await prisma.user.findMany({
      where: { id: { in: userIds } },
      orderBy: { email: 'asc' },
      select: { email: true },
    })).map((u) => u.email);

    for (const stored of [lower, mixed]) {
      const res = await signupReq({ name: 'New Person', email: stored.toLowerCase(), password: 'Long-enough1', acceptTerms: true });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'An account with this email already exists.',
        code: 'email-exists',
      });
    }
    expect(sendMock).not.toHaveBeenCalled();
    expect(await prisma.pendingSignup.count({ where: { email: { in: [lower, mixed] } } })).toBe(0);
  });

  it('rate-limits to one per cooldown with retryAfterMinutes, then allows a fresh sign-up', async () => {
    const email = `cooldown-${randomUUID()}@example.com`;
    emails.push(email);
    await doSignup(email);

    const second = await signupReq({ name: 'New Person', email, password: 'Long-enough1', acceptTerms: true });
    expect(second.status).toBe(429);
    const secondBody = await second.json();
    expect(secondBody.code).toBe('verification-pending');
    expect(secondBody.retryAfterMinutes).toBeGreaterThanOrEqual(1);
    expect(secondBody.error).toBe(
      `We already sent a verification link to this email a few minutes ago. Check your inbox and spam folder, or try again in ${secondBody.retryAfterMinutes} minutes.`,
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(await prisma.pendingSignup.count({ where: { email } })).toBe(1);

    // Once the cooldown passes, a fresh link can be requested (the old row
    // is replaced, so the first token dies).
    await prisma.pendingSignup.updateMany({
      where: { email },
      data: { createdAt: new Date(Date.now() - (SIGNUP_COOLDOWN_MINUTES + 1) * 60 * 1000) },
    });
    const firstToken = tokenFromLastEmail();
    await doSignup(email);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect((await verifyReq(firstToken)).status).toBe(404);
  });

  it('confirming creates the user with the chosen password, trial, terms fields and features', async () => {
    const email = `confirm-${randomUUID()}@example.com`;
    emails.push(email);
    const token = await doSignup(email, 'Brand-new-pass1');

    const res = await verifyReq(token);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, email });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { featureFlags: true },
    });
    userIds.push(user.id);
    expect(user.name).toBe('New Person');
    expect(user.role).toBe('staff');
    expect(user.status).toBe('active');
    expect(await bcrypt.compare('Brand-new-pass1', user.passwordHash)).toBe(true);
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

    expect((await verifyReq(token)).status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(user.id);

    const second = await verifyReq(token);
    expect(second.status).toBe(410);

    const invalid = await verifyReq('x'.repeat(43));
    expect(invalid.status).toBe(404);

    const expiredEmail = `expired-${randomUUID()}@example.com`;
    emails.push(expiredEmail);
    const expiredToken = await doSignup(expiredEmail);
    await prisma.pendingSignup.updateMany({
      where: { email: expiredEmail },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await verifyReq(expiredToken);
    expect(expired.status).toBe(410);
    expect(await prisma.user.findUnique({ where: { email: expiredEmail } })).toBeNull();
  });

  it('refuses a pre-migration pending row without a password hash and a 409 for a user that appeared meanwhile', async () => {
    const hashlessEmail = `hashless-${randomUUID()}@example.com`;
    emails.push(hashlessEmail);
    const hashlessToken = randomUUID();
    await prisma.pendingSignup.create({
      data: {
        email: hashlessEmail,
        name: 'Old Row',
        tokenHash: hashSignupToken(hashlessToken),
        termsVersion: TERMS_VERSION,
        expiresAt: signupExpiry(),
      },
    });
    const hashless = await verifyReq(hashlessToken);
    expect(hashless.status).toBe(410);
    expect((await hashless.json()).error).toBe('This sign-up link is no longer valid. Please sign up again.');
    expect(await prisma.user.findUnique({ where: { email: hashlessEmail } })).toBeNull();

    const raceEmail = `race-${randomUUID()}@example.com`;
    emails.push(raceEmail);
    const raceToken = await doSignup(raceEmail);
    const passwordHash = await bcrypt.hash('other-pass', 4);
    const winner = await prisma.user.create({
      data: { name: 'Race Winner', email: raceEmail, passwordHash, role: 'staff', trialEndsAt: null },
    });
    userIds.push(winner.id);

    const res = await verifyReq(raceToken);
    expect(res.status).toBe(409);
    expect(await prisma.user.count({ where: { email: raceEmail } })).toBe(1);
  });

  it('answers 502 and deletes the row when the email cannot be sent', async () => {
    const email = `fail-${randomUUID()}@example.com`;
    emails.push(email);
    sendMock.mockRejectedValueOnce(new Error('smtp down'));

    const res = await signupReq({ name: 'New Person', email, password: 'Long-enough1', acceptTerms: true });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'We could not send the verification email. Please try again.' });
    expect(await prisma.pendingSignup.count({ where: { email } })).toBe(0);
  });
});