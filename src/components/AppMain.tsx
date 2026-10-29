'use client';

import { usePathname } from 'next/navigation';
import { isPublicPath } from '@/components/Header';

// The public landing page at "/" is full-bleed and brings its own header and
// footer, so it must not sit inside the app's centered, padded <main>.
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The landing page and the public demo bring their own header and layout.
  if (pathname === '/' || pathname === '/demo') return <>{children}</>;
  // Signed-in pages get extra room at the bottom on phones for the fixed tab bar.
  return <main className={isPublicPath(pathname) ? 'app-main' : 'app-main app-main--with-nav'}>{children}</main>;
}
