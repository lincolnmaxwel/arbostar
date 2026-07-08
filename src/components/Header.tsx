'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { NewQuoteLink } from './NewQuoteLink';
import styles from './Header.module.css';

export function Header() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, [menuOpen]);

  if (pathname === '/login' || pathname.startsWith('/portal/')) return null;

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/quotes" className={styles.brand}>
          <svg className={styles.brandIcon} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2C8 2 5 5.5 5 9c0 2.2 1.2 3.9 2.8 5.1C6.7 15 6 16.4 6 18h5v4h2v-4h5c0-1.6-.7-3-1.8-3.9C17.8 12.9 19 11.2 19 9c0-3.5-3-7-7-7z"
              fill="currentColor"
            />
          </svg>
          Arbostar
        </Link>
        <nav className={styles.nav}>
          <Link href="/quotes" className={pathname === '/quotes' ? styles.active : ''}>Quotes</Link>
          <NewQuoteLink className={pathname.startsWith('/quotes/new') ? styles.active : ''}>New quote</NewQuoteLink>
          <Link href="/clients" className={pathname.startsWith('/clients') ? styles.active : ''}>Clients</Link>
          <Link href="/invoices" className={pathname.startsWith('/invoices') ? styles.active : ''}>Invoices</Link>
        </nav>
        <div className={styles.actions}>
          {userEmail ? (
            <div className={styles.userMenu} ref={menuRef}>
              <button
                type="button"
                className={styles.userMenuButton}
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
              >
                {userEmail}
              </button>
              {menuOpen && (
                <div className={styles.userMenuDropdown} role="menu">
                  <Link href="/profile" className={styles.userMenuItem} role="menuitem" onClick={() => setMenuOpen(false)}>
                    Profile
                  </Link>
                  <button
                    type="button"
                    className={styles.userMenuItem}
                    role="menuitem"
                    onClick={() => signOut({ callbackUrl: '/login' })}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className={styles.signOutButton} onClick={() => signOut({ callbackUrl: '/login' })}>
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
