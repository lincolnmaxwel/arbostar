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
    /** True when this session was revoked server-side (newer sign-in, admin reset, block). */
    revoked?: boolean;
    /** 'account' = blocked/deactivated/deleted; 'other-device' = replaced sign-in or admin reset. */
    revokedReason?: 'account' | 'other-device';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    sid?: string;
    revoked?: boolean;
    revokedReason?: 'account' | 'other-device';
  }
}
