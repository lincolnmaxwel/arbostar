import { Role } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    id: string;
    role: Role;
    /** Id of the sign-in that created this session (see User.sessionId). */
    sid?: string;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
    /** True when a newer sign-in on another device replaced this session. */
    revoked?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    sid?: string;
    revoked?: boolean;
  }
}
