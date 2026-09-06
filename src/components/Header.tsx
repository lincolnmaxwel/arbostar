'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { NewQuoteLink } from './NewQuoteLink';
import { getViewContext, resetViewContext } from '@/lib/clientUserContext';
import styles from './Header.module.css';

interface HeaderUser {
  id: string;
  name: string;
  email: string;
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const userEmail = session?.user?.email ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [isViewAs, setIsViewAs] = useState(false);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [features, setFeatures] = useState<{ quotes: boolean; invoices: boolean; timesheet: boolean; clients_crm: boolean } | null>(null);
  const [users, setUsers] = useState<HeaderUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const viewAsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getViewContext().then((ctx) => {
      if (cancelled || !ctx) return;
      setActorRole(ctx.actorRole);
      setIsViewAs(ctx.isViewAs);
      setTargetName(ctx.targetName);
      setFeatures({
        quotes: ctx.features.quotes,
        invoices: ctx.features.invoices,
        timesheet: ctx.features.timesheet,
        clients_crm: ctx.features.clients_crm,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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

  useEffect(() => {
    if (!viewAsOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setViewAsOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (viewAsRef.current && !viewAsRef.current.contains(e.target as Node)) {
        setViewAsOpen(false);
      }
    }
    document.addEventListener('click', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [viewAsOpen]);

  useEffect(() => {
    if (!viewAsOpen || actorRole !== 'admin') return;
    setUsersLoading(true);
    fetch('/api/admin/users')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.users) setUsers(body.users);
      })
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  }, [viewAsOpen, actorRole]);

  if (pathname === '/login' || pathname.startsWith('/portal/')) return null;

  async function handleViewAs(userId: string) {
    const res = await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return;
    setViewAsOpen(false);
    resetViewContext();
    router.refresh();
    window.location.href = '/quotes';
  }

  async function handleStopViewAs() {
    await fetch('/api/admin/view-as', { method: 'DELETE' });
    resetViewContext();
    setIsViewAs(false);
    setTargetName(null);
    router.refresh();
    window.location.href = '/quotes';
  }

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
        <nav className={styles.nav} aria-label="Primary navigation">
          <div className={styles.mainNav}>
            {features?.quotes && (
              <>
                <Link href="/quotes" className={pathname === '/quotes' ? styles.active : ''}>Quotes</Link>
                <NewQuoteLink className={pathname.startsWith('/quotes/new') ? styles.active : ''}>New quote</NewQuoteLink>
              </>
            )}
            {(features?.clients_crm || features?.timesheet) && (
              <Link href="/clients" className={pathname.startsWith('/clients') ? styles.active : ''}>Clients</Link>
            )}
            {features?.timesheet && (
              <Link href="/timesheet" className={pathname.startsWith('/timesheet') ? styles.active : ''}>Timesheet</Link>
            )}
            {features?.timesheet && (
              <Link href="/services" className={pathname.startsWith('/services') ? styles.active : ''}>Services</Link>
            )}
            {features?.invoices && (
              <Link href="/invoices" className={pathname.startsWith('/invoices') ? styles.active : ''}>Invoices</Link>
            )}
          </div>
        </nav>
        <div className={styles.actions}>
          {isViewAs && (
            <div className={styles.viewAsBanner}>
              <span className={styles.viewAsLabel} data-testid="viewing-as-indicator">
                Viewing as {targetName ?? 'another user'}
              </span>
              <button type="button" className={styles.stopViewAsButton} onClick={handleStopViewAs}>
                Stop viewing
              </button>
            </div>
          )}
          {actorRole === 'admin' && !isViewAs && (
            <div className={styles.viewAsWrap} ref={viewAsRef}>
              <button
                type="button"
                className={styles.viewAsButton}
                onClick={() => setViewAsOpen((v) => !v)}
                aria-expanded={viewAsOpen}
                aria-haspopup="menu"
                aria-controls="view-as-menu"
              >
                View as
              </button>
              {viewAsOpen && (
                <div id="view-as-menu" className={styles.viewAsDropdown} role="menu">
                  {usersLoading && <div className={styles.viewAsEmpty}>Loading users...</div>}
                  {!usersLoading && users.length === 0 && <div className={styles.viewAsEmpty}>No users</div>}
                  {!usersLoading &&
                    users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        role="menuitem"
                        className={styles.viewAsOption}
                        onClick={() => handleViewAs(u.id)}
                      >
                        {u.name} <span className={styles.viewAsOptionEmail}>{u.email}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
          {userEmail ? (
            <div className={styles.userMenu} ref={menuRef}>
              <button
                type="button"
                className={styles.userMenuButton}
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-controls="user-menu"
              >
                {userEmail}
              </button>
              {menuOpen && (
                <div id="user-menu" className={styles.userMenuDropdown} role="menu">
                  {actorRole === 'admin' && (
                    <Link href="/admin/users" className={styles.userMenuItem} role="menuitem" onClick={() => setMenuOpen(false)}>
                      Manage users
                    </Link>
                  )}
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
