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
        <Link href="/quotes" className={styles.brand}>Arbostar</Link>
        <nav className={styles.nav}>
          <Link href="/quotes" className={pathname === '/quotes' ? styles.active : ''}>Quotes</Link>
          <NewQuoteLink className={pathname.startsWith('/quotes/new') ? styles.active : ''}>New quote</NewQuoteLink>
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
