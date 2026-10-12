'use client';

import { useEffect } from 'react';
import { SessionProvider, signOut, useSession } from 'next-auth/react';

// Single active session per account: when another device signs in, this
// session is revoked server-side. Clear the cookie and send the user to the
// login page with an explanation.
function RevokedSessionGuard() {
  const { data: session } = useSession();
  const revoked = (session as { revoked?: boolean } | null)?.revoked === true;
  useEffect(() => {
    if (revoked) void signOut({ callbackUrl: '/login?reason=other-device' });
  }, [revoked]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // refetchInterval only polls while a session exists, so public pages
  // (landing, client portal) are not affected.
  return (
    <SessionProvider refetchInterval={30} refetchOnWindowFocus>
      <RevokedSessionGuard />
      {children}
    </SessionProvider>
  );
}
