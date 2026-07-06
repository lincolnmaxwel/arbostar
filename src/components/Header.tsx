'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { NewQuoteLink } from './NewQuoteLink';
import styles from './Header.module.css';

export function Header() {
  const pathname = usePathname();

  if (pathname === '/login' || pathname.startsWith('/portal/')) return null;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/quotes" className={styles.brand}>Arbostar</Link>
        <nav className={styles.nav}>
          <Link href="/quotes" className={pathname === '/quotes' ? styles.active : ''}>Quotes</Link>
          <NewQuoteLink className={pathname.startsWith('/quotes/new') ? styles.active : ''}>New quote</NewQuoteLink>
        </nav>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.signOutButton}
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
