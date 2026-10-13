import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';

// Stable, user-facing error messages surfaced by the login page when a real
// account exists but its status blocks sign-in. NextAuth v4.24.7 propagates
// the authorize() error message verbatim to the client sign-in result.
// Unknown email / wrong password still return null (generic "Invalid email
// or password").
export class AccountInactiveError extends Error {
  constructor() {
    super('Account is inactive.');
    this.name = 'AccountInactiveError';
  }
}

export class AccountBlockedError extends Error {
  constructor() {
    super('Account is blocked.');
    this.name = 'AccountBlockedError';
  }
}

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  if (user.status === 'inactive') throw new AccountInactiveError();
  if (user.status === 'blocked') throw new AccountBlockedError();
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * Sign-in: verify credentials, then rotate the user's single active session id.
 * Any JWT issued by an earlier sign-in carries the old id and is rejected by
 * the jwt callback below, so an account can only be used from one place.
 */
export async function authorizeCredentials(email: string, password: string) {
  const user = await verifyCredentials(email, password);
  if (!user) return null;
  const sid = randomUUID();
  await prisma.user.update({ where: { id: user.id }, data: { sessionId: sid } });
  return { ...user, sid };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return authorizeCredentials(credentials.email, credentials.password);
      },
    }),
  ],
  // Re-validate against the DB periodically-enough: the jwt callback runs on
  // every getServerSession()/session fetch.
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sid = user.sid;
        token.revoked = false;
        return token;
      }
      if (token.id) {
        const row = await prisma.user.findUnique({
          where: { id: token.id },
          select: { sessionId: true, status: true },
        });
        // Revoked when the account is gone/blocked/deactivated, or a newer
        // sign-in (or an admin password reset) replaced this one. A null
        // sessionId is a legacy account: its old tokens stay valid until its
        // next sign-in stamps an id.
        if (!row || row.status !== 'active') {
          token.revoked = true;
          token.revokedReason = 'account';
        } else if (row.sessionId !== null && row.sessionId !== token.sid) {
          token.revoked = true;
          token.revokedReason = 'other-device';
        } else {
          token.revoked = false;
          token.revokedReason = undefined;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.revoked) {
        // No user => every server check (`session?.user?.id`) treats this as
        // signed out; `revoked` lets the client explain why and clear the cookie.
        return {
          expires: session.expires,
          revoked: true,
          revokedReason: token.revokedReason ?? 'other-device',
        } as unknown as typeof session;
      }
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
};
