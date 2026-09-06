import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { verifyCredentials, AccountInactiveError, AccountBlockedError } from '@/lib/auth';

describe('verifyCredentials', () => {
  const email = `auth-test-${randomUUID()}@example.com`;
  const inactiveEmail = `auth-inactive-${randomUUID()}@example.com`;
  const blockedEmail = `auth-blocked-${randomUUID()}@example.com`;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    await prisma.user.create({
      data: { name: 'Auth Test', email, passwordHash, role: 'staff' },
    });
    await prisma.user.create({
      data: { name: 'Auth Inactive', email: inactiveEmail, passwordHash, role: 'staff', status: 'inactive' },
    });
    await prisma.user.create({
      data: { name: 'Auth Blocked', email: blockedEmail, passwordHash, role: 'staff', status: 'blocked' },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [email, inactiveEmail, blockedEmail] } },
    });
  });

  it('returns the user for correct credentials', async () => {
    const user = await verifyCredentials(email, 'correct-horse');
    expect(user?.email).toBe(email);
  });

  it('returns null for wrong password', async () => {
    const user = await verifyCredentials(email, 'wrong-password');
    expect(user).toBeNull();
  });

  it('returns null for unknown email', async () => {
    const user = await verifyCredentials('nobody@example.com', 'whatever');
    expect(user).toBeNull();
  });

  it('throws a stable "Account is inactive." error for an inactive user', async () => {
    await expect(verifyCredentials(inactiveEmail, 'correct-horse')).rejects.toBeInstanceOf(
      AccountInactiveError,
    );
    await expect(verifyCredentials(inactiveEmail, 'correct-horse')).rejects.toThrow(
      'Account is inactive.',
    );
  });

  it('throws a stable "Account is blocked." error for a blocked user', async () => {
    await expect(verifyCredentials(blockedEmail, 'correct-horse')).rejects.toBeInstanceOf(
      AccountBlockedError,
    );
    await expect(verifyCredentials(blockedEmail, 'correct-horse')).rejects.toThrow(
      'Account is blocked.',
    );
  });
});