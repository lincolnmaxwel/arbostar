import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import type { JWT } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { authOptions, authorizeCredentials } from '@/lib/auth';

const email = `single-session-${randomUUID()}@example.com`;
let userId = '';

type JwtArgs = Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>>[0];

// Mirrors what NextAuth does: first call carries `user`, later calls only the token.
async function issueToken(sid: string | undefined): Promise<JWT> {
  const jwt = authOptions.callbacks!.jwt!;
  return jwt({ token: {} as JWT, user: { id: userId, role: 'staff', sid } } as unknown as JwtArgs);
}
async function reread(token: JWT): Promise<JWT> {
  const jwt = authOptions.callbacks!.jwt!;
  return jwt({ token } as unknown as JwtArgs);
}

describe('single active session', () => {
  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    const user = await prisma.user.create({ data: { name: 'Single Session', email, passwordHash, role: 'staff' } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  it('a second sign-in revokes the first one', async () => {
    const a = await authorizeCredentials(email, 'correct-horse');
    const tokenA = await issueToken(a!.sid);
    expect((await reread(tokenA)).revoked).toBe(false);

    const b = await authorizeCredentials(email, 'correct-horse');
    const tokenB = await issueToken(b!.sid);

    expect((await reread(tokenA)).revoked).toBe(true);
    expect((await reread(tokenB)).revoked).toBe(false);

    const session = await authOptions.callbacks!.session!({
      session: { expires: 'x', user: { id: userId } },
      token: await reread(tokenA),
    } as never);
    expect((session as { user?: unknown }).user).toBeUndefined();
    expect((session as { revoked?: boolean }).revoked).toBe(true);
  });

  it('a wrong password does not rotate the active session', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await authorizeCredentials(email, 'nope')).toBeNull();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.sessionId).toBe(before.sessionId);
  });

  it('legacy tokens (no sid) stay valid until the account signs in again', async () => {
    await prisma.user.update({ where: { id: userId }, data: { sessionId: null } });
    expect((await reread({ id: userId, role: 'staff' } as JWT)).revoked).toBe(false);
    await authorizeCredentials(email, 'correct-horse');
    expect((await reread({ id: userId, role: 'staff' } as JWT)).revoked).toBe(true);
  });

  it('a deleted account is revoked', async () => {
    expect((await reread({ id: randomUUID(), role: 'staff', sid: 'x' } as JWT)).revoked).toBe(true);
  });
});
