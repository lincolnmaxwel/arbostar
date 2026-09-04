import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
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
        return verifyCredentials(credentials.email, credentials.password);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
  },
};
