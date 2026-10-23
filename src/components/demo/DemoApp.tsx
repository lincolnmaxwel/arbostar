'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isoDay, seedDemoData, type DemoData } from '@/lib/demoData';
import type { DemoNav, DemoTab } from './demoTypes';
import { DemoQuotes } from './DemoQuotes';
import { DemoClients } from './DemoClients';
import { DemoTimesheet } from './DemoTimesheet';
import { DemoServices } from './DemoServices';
import { DemoInvoices } from './DemoInvoices';
import { DemoFinancial } from './DemoFinancial';
import styles from './demo.module.css';

const TABS: { key: DemoTab; label: string }[] = [
  { key: 'quotes', label: 'Quotes' },
  { key: 'clients', label: 'Clients' },
  { key: 'timesheet', label: 'Timesheet' },
  { key: 'services', label: 'Services' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'financial', label: 'Financial' },
];

// The whole demo lives in React state: nothing is sent to a server or stored,
// so a reload (or "Reset demo") always brings back the original sample data.
export function DemoApp() {
  const [today, setToday] = useState<string | null>(null);
  const [data, setData] = useState<DemoData | null>(null);
  const [nav, setNav] = useState<DemoNav>({ tab: 'quotes' });
  const [message, setMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seeded after mount: the sample dates are relative to the visitor's today.
  useEffect(() => {
    const t = isoDay(new Date());
    setToday(t);
    setData(seedDemoData(t));
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const toast = useCallback((text: string) => {
    setMessage(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(null), 3500);
  }, []);

  const update = useCallback((fn: (d: DemoData) => DemoData) => {
    setData((d) => (d ? fn(d) : d));
  }, []);

  const go = useCallback((tab: DemoTab, id?: string) => {
    setNav({ tab, id });
    window.scrollTo({ top: 0 });
  }, []);

  function reset() {
    if (!today) return;
    setData(seedDemoData(today));
    setNav({ tab: 'quotes' });
    toast('Demo reset to the original sample data.');
  }

  const screenProps = data && today ? { data, update, today, nav, go, toast } : null;

  return (
    <div className={styles.shell}>
      <div className={styles.banner} role="note">
        <span className={styles.bannerText}>
          <strong>Demo mode</strong> - sample data, nothing you do here is saved. Click around, add things, break things.
        </span>
        <Link href="/signup" className={styles.bannerButton}>
          Start free trial
        </Link>
        <button type="button" className={styles.bannerGhost} onClick={reset}>
          Reset demo
        </button>
        <Link href="/" className={styles.bannerGhost}>
          Back to home
        </Link>
      </div>

      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/myjobbs-logo2.png" alt="MyJobbs.com" className={styles.logo} />
          <nav className={styles.tabs} aria-label="Demo sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`${styles.tab} ${nav.tab === t.key ? styles.tabActive : ''}`}
                aria-current={nav.tab === t.key ? 'page' : undefined}
                onClick={() => go(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className={styles.user}>Demo user</div>
        </div>
      </header>

      <main className={styles.main}>
        {!screenProps ? (
          <p className={styles.loading}>Loading demo...</p>
        ) : (
          <>
            {nav.tab === 'quotes' && <DemoQuotes {...screenProps} />}
            {nav.tab === 'clients' && <DemoClients {...screenProps} />}
            {nav.tab === 'timesheet' && <DemoTimesheet {...screenProps} />}
            {nav.tab === 'services' && <DemoServices {...screenProps} />}
            {nav.tab === 'invoices' && <DemoInvoices {...screenProps} />}
            {nav.tab === 'financial' && <DemoFinancial {...screenProps} />}

            <section className={styles.ctaCard}>
              <h2>Like what you see?</h2>
              <p>Create your own account and try it with your real jobs.</p>
              <Link href="/signup" className={styles.ctaButton}>
                Start free trial
              </Link>
            </section>
          </>
        )}
      </main>

      {message && (
        <div className={styles.toast} role="status">
          {message}
        </div>
      )}
    </div>
  );
}
