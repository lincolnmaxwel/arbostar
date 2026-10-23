'use client';

import { usePathname } from 'next/navigation';

// The public landing page at "/" is full-bleed and brings its own header and
// footer, so it must not sit inside the app's centered, padded <main>.
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The landing page and the public demo bring their own header and layout.
  if (pathname === '/' || pathname === '/demo') return <>{children}</>;
  return <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '24px 16px' }}>{children}</main>;
}
