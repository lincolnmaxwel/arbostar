'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, MouseEvent } from 'react';

// Renders as a plain <a href="/quotes/new"> (so middle-click/open-in-new-tab
// and the SW's cached bare "/quotes/new" shell still work as a fallback), but
// a normal click mints the fresh draftId immediately and pushes straight to
// /quotes/new?draft=<id> in one hop — instead of navigating to the bare path
// first and letting a client useEffect mint the id and redirect a second
// time. That second hop is a second navigation Next has to resolve (and,
// mounted globally in the Header, a component that only mints its id once on
// mount would go stale and silently reopen the same draft on every later
// click) — going straight to the final URL with a client-generated id
// sidesteps both.
export function NewQuoteLink({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(`/quotes/new?draft=${crypto.randomUUID()}`);
  }

  return (
    <a href="/quotes/new" className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
