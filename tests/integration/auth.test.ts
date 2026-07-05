import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { verifyCredentials } from '@/lib/auth';

describe('verifyCredentials', () => {
  const email = 'auth-test@example.com';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    await prisma.user.create({
      data: { name: 'Auth Test', email, passwordHash, role: 'staff' },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { email } });
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
});
