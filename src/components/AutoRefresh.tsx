'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Mounted on server-rendered, force-dynamic pages (Invoices, Clients) that
// only ever re-run their Prisma query on navigation — without this, an
// invoice generated (or a client confirmed) while the page is already open
// never appears until a manual reload. router.refresh() re-runs the page's
// Server Component with fresh data in place, no full navigation/reload.
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
