'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { NewQuoteLink } from './NewQuoteLink';
import { getViewContext, refreshViewContext, resetViewContext } from '@/lib/clientUserContext';
import { useLivePolling } from '@/lib/useLivePolling';
import { clearOfflineCaches, LAST_EMAIL_KEY } from '@/lib/clearOfflineCaches';
import type { BillingInfo } from '@/lib/billing';
import styles from './Header.module.css';

interface HeaderUser {
  id: string;
  name: string;
  email: string;
}

// Pages that render without the app header (landing, auth flows, legal, the
// public client portal).
const PUBLIC_EXACT = ['/', '/demo', '/login', '/signup', '/forgot-password', '/terms', '/privacy'];
const PUBLIC_PREFIXES = ['/portal/', '/invite/', '/signup/', '/reset-password/'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();
  // Offline the session fetch fails and useSession() goes empty; keep showing
  // the last known email (and the user menu) instead of dropping to a bare
  // "Sign out" button.
  const [lastEmail, setLastEmail] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (session?.user?.email) {
        setLastEmail(session.user.email);
        window.localStorage.setItem(LAST_EMAIL_KEY, session.user.email);
      } else {
        // Reloaded while offline: fall back to the email remembered on this device.
        const remembered = window.localStorage.getItem(LAST_EMAIL_KEY);
        if (remembered) setLastEmail(remembered);
      }
    } catch {
      // storage unavailable: the menu just hides while offline
    }
  }, [session?.user?.email]);
  const userEmail = session?.user?.email ?? lastEmail;

  async function handleSignOut() {
    await clearOfflineCaches();
    await signOut({ callbackUrl: '/login' });
  }
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [isViewAs, setIsViewAs] = useState(false);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [ctxVersion, setCtxVersion] = useState(0);
  const [features, setFeatures] = useState<{ quotes: boolean; invoices: boolean; timesheet: boolean; clients_crm: boolean } | null>(null);
  const [users, setUsers] = useState<HeaderUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const viewAsRef = useRef<HTMLDivElement>(null);

  // A new logo URL gets a fresh chance to load after an earlier failure.
  useEffect(() => {
    setLogoBroken(false);
  }, [companyLogo]);

  // Phones: the header slides away while scrolling down (more room for long
  // pages) and stays away until the user is back at the very top of the page.
  // The class only has an effect on narrow screens (see Header.module.css).
  const [scrolledAway, setScrolledAway] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 8) {
          setScrolledAway(false);
        } else if (delta > 8 && y >= 80) {
          setScrolledAway(true);
        }
        lastY = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    setScrolledAway(false);
  }, [pathname]);

  // Live: an admin changing this account (trial days, subscription, block,
  // password) reaches the open session within seconds - no reload needed.
  useLivePolling(async () => {
    if (isPublicPath(pathname)) return;
    const { ctx, unauthorized } = await refreshViewContext();
    if (unauthorized) {
      // Blocked / session replaced: let the session guard sign this tab out.
      await updateSession();
      return;
    }
    if (!ctx) return;
    setActorRole(ctx.actorRole);
    setIsViewAs(ctx.isViewAs);
    setTargetName(ctx.targetName);
    setBilling(ctx.billing ?? null);
    setCompanyLogo(ctx.companyLogoUrl ?? null);
    setFeatures({
      quotes: ctx.features.quotes,
      invoices: ctx.features.invoices,
      timesheet: ctx.features.timesheet,
      clients_crm: ctx.features.clients_crm,
    });
  }, 10000);

  useEffect(() => {
    // Public pages render no header and have no session: asking for the
    // user context there only produces a 401 in the console.
    if (isPublicPath(pathname)) return;
    let cancelled = false;
    getViewContext().then((ctx) => {
      if (cancelled || !ctx) return;
      setActorRole(ctx.actorRole);
      setIsViewAs(ctx.isViewAs);
      setTargetName(ctx.targetName);
      setBilling(ctx.billing ?? null);
      setCompanyLogo(ctx.companyLogoUrl ?? null);
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
  }, [pathname, ctxVersion]);

  // The billing page announces subscription changes (payment confirmed,
  // subscription deleted by an admin...) so nav, banner and the access gate
  // update without a reload.
  useEffect(() => {
    const onBillingChanged = () => setCtxVersion((v) => v + 1);
    window.addEventListener('myjobbs:billing-changed', onBillingChanged);
    return () => window.removeEventListener('myjobbs:billing-changed', onBillingChanged);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      // The product tour keeps the menu open while it points at Profile.
      if (document.body.dataset.tourActive) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, [menuOpen]);

  // The product tour opens/closes the account menu to point at Profile.
  useEffect(() => {
    const onSetMenu = (e: Event) => setMenuOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open));
    window.addEventListener('myjobbs:user-menu', onSetMenu);
    return () => window.removeEventListener('myjobbs:user-menu', onSetMenu);
  }, []);

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

  // A lapsed trial/subscription locks the app: send the user to the billing
  // page (the only place that can fix it). Admins viewing as someone else are
  // left alone so they can still inspect that account.
  useEffect(() => {
    if (!billing || billing.access || isViewAs) return;
    const open = pathname.startsWith('/billing') || pathname.startsWith('/profile') || pathname.startsWith('/admin');
    if (!open && !isPublicPath(pathname)) router.replace('/billing');
  }, [billing, isViewAs, pathname, router]);

  if (isPublicPath(pathname)) return null;

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

  const billingNotice = !isViewAs && !pathname.startsWith('/billing') ? describeBillingNotice(billing) : null;
  // Admin viewing a locked account still sees all its data; just say it is locked.
  const lockedViewAsNotice =
    isViewAs && billing && !billing.access
      ? `This account's ${billing.phase === 'canceled' ? 'subscription has ended' : 'free trial has ended'}, so the user is locked out of MyJobbs. You can still see everything as an admin.`
      : null;

  return (
    <>
    <header className={`${styles.header} ${scrolledAway && !menuOpen && !viewAsOpen ? styles.headerHidden : ''}`}>
      <div className={styles.inner}>
        <Link href="/quotes" className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.brandLogo} />
        </Link>
        <nav className={styles.nav} aria-label="Primary navigation">
          <div className={styles.mainNav}>
            {features?.quotes && (
              <>
                <Link href="/quotes" data-tour="nav-quotes" className={pathname === '/quotes' ? styles.active : ''}>Quotes</Link>
                <NewQuoteLink data-tour="nav-new-quote" className={pathname.startsWith('/quotes/new') ? styles.active : ''}>New quote</NewQuoteLink>
              </>
            )}
            {(features?.clients_crm || features?.timesheet) && (
              <Link href="/clients" data-tour="nav-clients" className={pathname.startsWith('/clients') ? styles.active : ''}>Clients</Link>
            )}
            {features?.timesheet && (
              <Link href="/timesheet" data-tour="nav-timesheet" className={pathname.startsWith('/timesheet') ? styles.active : ''}>Timesheet</Link>
            )}
            {features?.timesheet && (
              <Link href="/services" data-tour="nav-services" className={pathname.startsWith('/services') ? styles.active : ''}>Services</Link>
            )}
            {features?.invoices && (
              <Link href="/invoices" data-tour="nav-invoices" className={pathname.startsWith('/invoices') ? styles.active : ''}>Invoices</Link>
            )}
            {features?.invoices && (
              <Link href="/financial" data-tour="nav-financial" className={pathname.startsWith('/financial') ? styles.active : ''}>Financial</Link>
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
                data-tour="user-menu"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-controls="user-menu"
              >
                <span className={styles.userAvatar} aria-hidden="true">
                  {companyLogo && !logoBroken ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={companyLogo} alt="" className={styles.userAvatarImage} onError={() => setLogoBroken(true)} />
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <circle cx="12" cy="8.5" r="4" />
                      <path d="M4 20.5c0-4.1 3.6-6.5 8-6.5s8 2.4 8 6.5z" />
                    </svg>
                  )}
                </span>
                <span className={styles.userMenuText}>{userEmail}</span>
              </button>
              {menuOpen && (
                <div id="user-menu" className={styles.userMenuDropdown} role="menu">
                  {actorRole === 'admin' && (
                    <Link href="/admin/users" className={styles.userMenuItem} role="menuitem" onClick={() => setMenuOpen(false)}>
                      Manage users
                    </Link>
                  )}
                  <Link href="/profile" data-tour="menu-profile" className={styles.userMenuItem} role="menuitem" onClick={() => setMenuOpen(false)}>
                    Profile
                  </Link>
                  <Link href="/billing" className={styles.userMenuItem} role="menuitem" onClick={() => setMenuOpen(false)}>
                    {actorRole === 'admin' ? 'Subscriptions' : 'Subscription'}
                  </Link>
                  {!isViewAs && (
                    <button
                      type="button"
                      className={styles.userMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        window.dispatchEvent(new Event('myjobbs:start-tour'));
                      }}
                    >
                      Product tour
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.userMenuItem}
                    role="menuitem"
                    onClick={handleSignOut}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className={styles.signOutButton} onClick={handleSignOut}>
              Sign out
            </button>
          )}
        </div>
      </div>
    </header>
    {lockedViewAsNotice && (
      <div className={styles.billingBannerUrgent} role="status" data-testid="view-as-locked-notice">
        <span>{lockedViewAsNotice}</span>
      </div>
    )}
    {billingNotice && (
      <div className={billingNotice.urgent ? styles.billingBannerUrgent : styles.billingBanner} role="status">
        <span>{billingNotice.text}</span>
        <Link href="/billing" className={styles.billingBannerLink}>
          {billingNotice.cta}
        </Link>
      </div>
    )}
    </>
  );
}

function describeBillingNotice(billing: BillingInfo | null): { text: string; cta: string; urgent: boolean } | null {
  if (!billing || billing.phase === 'exempt') return null;
  const days = billing.daysLeft ?? 0;
  const dayLabel = days === 1 ? '1 day' : `${days} days`;

  if (!billing.access) {
    return {
      text:
        billing.phase === 'canceled'
          ? 'Your subscription has ended. Subscribe to keep using MyJobbs.'
          : 'Your free trial has ended. Subscribe to keep using MyJobbs.',
      cta: 'Subscribe',
      urgent: true,
    };
  }
  if (billing.phase === 'past_due') {
    return { text: 'We could not process your last payment. Please update your payment method.', cta: 'Fix payment', urgent: true };
  }
  if (!billing.inRenewWindow) return null;
  if (billing.phase === 'trial') {
    return { text: `Your free trial ends in ${dayLabel}.`, cta: 'Subscribe', urgent: false };
  }
  if (billing.canRenew) {
    return { text: `Your subscription ends in ${dayLabel}.`, cta: 'Renew', urgent: false };
  }
  return null;
}
