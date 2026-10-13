'use client';

import { useEffect } from 'react';
import { SessionProvider, signOut, useSession } from 'next-auth/react';

// Single active session per account: when another device signs in, this
// session is revoked server-side. Clear the cookie and send the user to the
// login page with an explanation.
function RevokedSessionGuard() {
  const { data: session } = useSession();
  const info = session as { revoked?: boolean; revokedReason?: string } | null;
  const revoked = info?.revoked === true;
  const reason = info?.revokedReason === 'account' ? 'account' : 'other-device';
  useEffect(() => {
    if (!revoked) return;
    // redirect:false + a relative navigation: never depends on NEXTAUTH_URL
    // matching the host the user is actually on.
    void signOut({ redirect: false }).finally(() => {
      window.location.href = `/login?reason=${reason}`;
    });
  }, [revoked, reason]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // refetchInterval only polls while a session exists, so public pages
  // (landing, client portal) are not affected.
  return (
    <SessionProvider refetchInterval={10} refetchOnWindowFocus>
      <RevokedSessionGuard />
      {children}
    </SessionProvider>
  );
}
