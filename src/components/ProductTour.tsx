'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getViewContext } from '@/lib/clientUserContext';
import { isPublicPath } from '@/components/Header';
import { TOUR_STEPS } from '@/lib/tourSteps';
import styles from './ProductTour.module.css';

export const START_TOUR_EVENT = 'myjobbs:start-tour';

const WAIT_FOR_TARGET_MS = 5000;
const SPOTLIGHT_PAD = 6;
const CARD_GAP = 12;
const EDGE = 12;
const CARD_WIDTH = 420; // keep in sync with .card in ProductTour.module.css

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function targetEl(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

async function waitForTarget(target: string): Promise<boolean> {
  const until = Date.now() + WAIT_FOR_TARGET_MS;
  while (Date.now() < until) {
    if (targetEl(target)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * First-login guided tour: dims the page and highlights, one at a time, the
 * Profile blocks and the main menu entries with a short explanation. Shown
 * once to accounts that have not finished or skipped it (`tourPending` from
 * /api/view-context); finishing or skipping records it so it does not come
 * back. The user menu's "Product tour" replays it on demand.
 */
export function ProductTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const scrolledFor = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const hasBox = box !== null;
  const step = index === null ? null : TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  const finish = useCallback(() => {
    setIndex(null);
    setBox(null);
    started.current = true;
    fetch('/api/profile/tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true }),
    }).catch(() => {});
  }, []);

  // Auto-start for an account that has not seen the tour yet.
  useEffect(() => {
    if (isPublicPath(pathname) || started.current) return;
    let cancelled = false;
    getViewContext().then((ctx) => {
      if (cancelled) return;
      // An admin can switch the tour back on later: forget a finished one.
      if (!ctx?.tourPending) {
        started.current = false;
        return;
      }
      if (started.current) return;
      if (ctx.isViewAs || ctx.billing?.access === false) return;
      started.current = true;
      setIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Replay from the user menu.
  useEffect(() => {
    const onStart = () => {
      started.current = true;
      scrolledFor.current = null;
      setIndex(0);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  // Go to the next step in `dir` that can be shown: a step whose target is not
  // on the page (a feature this account does not have) is skipped.
  const goTo = useCallback(
    async (from: number, dir: 1 | -1) => {
      setBusy(true);
      let i = from;
      while (i >= 0 && i < TOUR_STEPS.length) {
        const s = TOUR_STEPS[i];
        if (!s.target) break;
        if (s.route && window.location.pathname !== s.route) router.push(s.route);
        if (await waitForTarget(s.target)) break;
        i += dir;
      }
      setBusy(false);
      if (i < 0) i = 0;
      if (i >= TOUR_STEPS.length) return finish();
      scrolledFor.current = null;
      setIndex(i);
    },
    [router, finish],
  );

  // Keep the spotlight on its element while the page scrolls, resizes or loads.
  useEffect(() => {
    if (!step?.target) {
      setBox(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const el = targetEl(step.target as string);
      if (el) {
        if (scrolledFor.current !== index) {
          scrolledFor.current = index;
          const r = el.getBoundingClientRect();
          const inHeader = Boolean(el.closest('header'));
          window.scrollTo({ top: inHeader ? 0 : Math.max(0, r.top + window.scrollY - 78), behavior: 'smooth' });
        }
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        setBox((prev) => (sameBox(prev, next) ? prev : next));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [step, index]);

  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    setCardHeight((prev) => (prev === h ? prev : h));
  }, [index, hasBox]);

  useEffect(() => {
    if (index === null) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, finish]);

  if (index === null || !step || isPublicPath(pathname)) return null;

  const centered = !step.target || !box;
  let cardStyle: React.CSSProperties | undefined;
  if (!centered && box) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_WIDTH, vw - 2 * EDGE);
    const left = Math.min(Math.max(box.left, EDGE), vw - width - EDGE);
    let top: number;
    if (box.top + box.height + CARD_GAP + cardHeight <= vh - EDGE) top = box.top + box.height + CARD_GAP;
    else if (box.top - CARD_GAP - cardHeight >= EDGE) top = box.top - CARD_GAP - cardHeight;
    else top = vh - cardHeight - EDGE; // target too tall: card pinned to the bottom
    cardStyle = { top, left };
  }

  const progress = Math.round((index / (TOUR_STEPS.length - 1)) * 100);
  const primaryLabel = index === 0 ? 'Start tour' : isLast ? 'Finish' : 'Next';

  return (
    <>
      <div className={styles.blocker} aria-hidden="true" />
      {centered || !box ? (
        <div className={styles.dim} aria-hidden="true" />
      ) : (
        <div
          className={styles.spotlight}
          aria-hidden="true"
          style={{
            top: box.top - SPOTLIGHT_PAD,
            left: box.left - SPOTLIGHT_PAD,
            width: box.width + 2 * SPOTLIGHT_PAD,
            height: box.height + 2 * SPOTLIGHT_PAD,
          }}
        />
      )}
      <div
        ref={cardRef}
        className={`${styles.card} ${centered ? styles.centered : ''}`}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        data-testid="product-tour"
      >
        <div className={styles.step}>{index === 0 ? 'Quick tour' : isLast ? 'Done' : `Tour · ${progress}%`}</div>
        <h2 id="tour-title" className={styles.title}>
          {step.title}
        </h2>
        <p className={styles.text}>{step.text}</p>
        <div className={styles.actions}>
          {!isLast && (
            <button type="button" className={styles.skip} onClick={finish} data-compact>
              {index === 0 ? 'Skip tour' : 'Skip'}
            </button>
          )}
          <span className={styles.spacer} />
          {index > 0 && (
            <button type="button" className={styles.back} disabled={busy} onClick={() => goTo(index - 1, -1)}>
              Back
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className={styles.next}
            disabled={busy}
            onClick={() => (isLast ? finish() : goTo(index + 1, 1))}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </>
  );
}
