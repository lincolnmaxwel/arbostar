'use client';

import { useEffect, useState } from 'react';

const DETACH_AT = 24;

// Landing header: a full-width bar at the top of the page that detaches into a
// floating pill once the visitor scrolls down, and docks back at the very top.
// Only a class is toggled; the CSS animates it (the header keeps its height, so
// the page below never jumps).
export function FloatingNav({
  className,
  floatingClassName,
  children,
}: {
  className: string;
  floatingClassName: string;
  children: React.ReactNode;
}) {
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    const onScroll = () => setFloating(window.scrollY > DETACH_AT);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return <header className={floating ? `${className} ${floatingClassName}` : className}>{children}</header>;
}
