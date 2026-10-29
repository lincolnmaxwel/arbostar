'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './MobileNav.module.css';

export interface MobileNavFeatures {
  quotes: boolean;
  invoices: boolean;
  timesheet: boolean;
  clients_crm: boolean;
}

type IconName = 'quotes' | 'timesheet' | 'clients' | 'invoices' | 'services' | 'financial' | 'more' | 'profile' | 'billing' | 'users' | 'tour' | 'signout';

// Outline icons (24x24, 1.8 stroke), drawn inline so the bar needs no assets.
function Icon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" {...common}>
      {name === 'quotes' && (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </>
      )}
      {name === 'timesheet' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === 'clients' && (
        <>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
          <path d="M16 4.9a3.2 3.2 0 0 1 0 6.2M18 14.8c1.8.7 3 2.3 3 5.2" />
        </>
      )}
      {name === 'invoices' && (
        <>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6" />
        </>
      )}
      {name === 'services' && (
        <>
          <path d="M3 12V4h8l10 10-8 8z" />
          <circle cx="7.5" cy="8.5" r="1.2" />
        </>
      )}
      {name === 'financial' && (
        <>
          <path d="M4 20V4M4 20h16" />
          <path d="M8 16v-4M12 16V8M16 16v-6" />
        </>
      )}
      {name === 'more' && (
        <>
          <circle cx="5" cy="12" r="1.3" fill="currentColor" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" />
          <circle cx="19" cy="12" r="1.3" fill="currentColor" />
        </>
      )}
      {name === 'profile' && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
        </>
      )}
      {name === 'billing' && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 10h18M7 15h3" />
        </>
      )}
      {name === 'users' && (
        <>
          <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </>
      )}
      {name === 'tour' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.6M12 17h.01" />
        </>
      )}
      {name === 'signout' && (
        <>
          <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
          <path d="M16 8l4 4-4 4M20 12H9" />
        </>
      )}
    </svg>
  );
}

/**
 * Phone navigation (<= 640px): an app-style tab bar fixed to the bottom with
 * the main pages plus "More", which opens a sheet with the remaining pages and
 * the account actions. Hidden on larger screens (the top header keeps its
 * links there). Same feature rules as the desktop header.
 */
export function MobileNav({
  features,
  pathname,
  open,
  onToggle,
  onClose,
  isAdmin,
  isViewAs,
  email,
  onSignOut,
  onStartTour,
}: {
  features: MobileNavFeatures | null;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  isAdmin: boolean;
  isViewAs: boolean;
  email: string | null;
  onSignOut: () => void;
  onStartTour: () => void;
}) {
  // The on-screen keyboard would sit on top of the bar: tuck it away while a
  // text field has focus.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
      if (el.tagName !== 'INPUT') return false;
      return !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes((el as HTMLInputElement).type);
    };
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  const tabs: { href: string; label: string; tour: string; icon: IconName; active: boolean }[] = [];
  if (features?.quotes) tabs.push({ href: '/quotes', label: 'Quotes', tour: 'nav-quotes', icon: 'quotes', active: pathname.startsWith('/quotes') });
  if (features?.timesheet) tabs.push({ href: '/timesheet', label: 'Timesheet', tour: 'nav-timesheet', icon: 'timesheet', active: pathname.startsWith('/timesheet') });
  if (features?.clients_crm || features?.timesheet) tabs.push({ href: '/clients', label: 'Clients', tour: 'nav-clients', icon: 'clients', active: pathname.startsWith('/clients') });
  if (features?.invoices) tabs.push({ href: '/invoices', label: 'Invoices', tour: 'nav-invoices', icon: 'invoices', active: pathname.startsWith('/invoices') });

  const extra: { href: string; label: string; tour: string; icon: IconName }[] = [];
  if (features?.timesheet) extra.push({ href: '/services', label: 'Services', tour: 'nav-services', icon: 'services' });
  if (features?.invoices) extra.push({ href: '/financial', label: 'Financial', tour: 'nav-financial', icon: 'financial' });

  const inMore = ['/services', '/financial', '/profile', '/billing', '/admin'].some((p) => pathname.startsWith(p));

  return (
    <div data-mobile-nav data-tour-fixed>
      {open && <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />}
      {open && (
        <div id="mobile-more" className={styles.sheet} role="menu" aria-label="More">
          {email && <p className={styles.sheetEmail}>{email}</p>}
          {extra.map((e) => (
            <Link key={e.href} href={e.href} className={styles.sheetItem} role="menuitem" data-tour={e.tour} onClick={onClose}>
              <Icon name={e.icon} />
              {e.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin/users" className={styles.sheetItem} role="menuitem" onClick={onClose}>
              <Icon name="users" />
              Manage users
            </Link>
          )}
          <Link href="/profile" className={styles.sheetItem} role="menuitem" data-tour="menu-profile" onClick={onClose}>
            <Icon name="profile" />
            Profile
          </Link>
          <Link href="/billing" className={styles.sheetItem} role="menuitem" onClick={onClose}>
            <Icon name="billing" />
            {isAdmin ? 'Subscriptions' : 'Subscription'}
          </Link>
          {!isViewAs && (
            <button
              type="button"
              className={styles.sheetItem}
              role="menuitem"
              onClick={() => {
                onClose();
                onStartTour();
              }}
            >
              <Icon name="tour" />
              Product tour
            </button>
          )}
          <button type="button" className={`${styles.sheetItem} ${styles.sheetDanger}`} role="menuitem" onClick={onSignOut}>
            <Icon name="signout" />
            Sign out
          </button>
        </div>
      )}
      <nav className={`${styles.bar} ${typing ? styles.barHidden : ''}`} aria-label="Main">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`${styles.item} ${t.active && !open ? styles.active : ''}`}
            aria-current={t.active ? 'page' : undefined}
            data-tour={t.tour}
            data-tour-label={t.label}
            onClick={onClose}
          >
            <span className={styles.iconWrap}>
              <Icon name={t.icon} />
            </span>
            {t.label}
          </Link>
        ))}
        <button
          type="button"
          className={`${styles.item} ${open || inMore ? styles.active : ''}`}
          data-tour="user-menu"
          data-tour-label="More"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls="mobile-more"
          onClick={onToggle}
        >
          <span className={styles.iconWrap}>
            <Icon name="more" />
          </span>
          More
        </button>
      </nav>
    </div>
  );
}
