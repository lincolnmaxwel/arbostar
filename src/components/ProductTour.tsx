'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getViewContext, type ViewContext } from '@/lib/clientUserContext';
import { isPublicPath } from '@/components/Header';
import { TOUR_STEPS, type TourStep } from '@/lib/tourSteps';
import styles from './ProductTour.module.css';

export const START_TOUR_EVENT = 'myjobbs:start-tour';
const USER_MENU_EVENT = 'myjobbs:user-menu';

const WAIT_FOR_TARGET_MS = 5000;
const POINT_AT_MENU_MS = 800; // how long the menu link is highlighted before "clicking" it
const SPOTLIGHT_PAD = 6;
const CARD_GAP = 12;
const HEADER_SAFE = 72; // the sticky header (and its highlighted menu link) stays uncovered
const EDGE = 12;
const CARD_WIDTH = 420; // keep in sync with .card in ProductTour.module.css
const MIN_SIDE_WIDTH = 300; // narrowest card worth putting beside a block

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget(target: string): Promise<boolean> {
  const until = Date.now() + WAIT_FOR_TARGET_MS;
  while (Date.now() < until) {
    if (targetEl(target)) return true;
    await sleep(100);
  }
  return false;
}

function setAccountMenu(open: boolean) {
  window.dispatchEvent(new CustomEvent(USER_MENU_EVENT, { detail: { open } }));
}

function hasFeature(step: TourStep, features: ViewContext['features'] | null): boolean {
  if (!step.requires) return true;
  if (!features) return false;
  return step.requires.some((f) => features[f]);
}

/**
 * First-login guided tour: dims the page and highlights, one at a time, the
 * account menu, the Profile blocks (which stay editable so the user can fill
 * them in right away) and then each main page, which the tour opens itself by
 * "clicking" its menu link. Shown once to accounts that have not finished or
 * skipped it (`tourPending` from /api/view-context); finishing or skipping
 * records it so it does not come back. The account menu's "Product tour"
 * replays it on demand.
 */
export function ProductTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [menuBox, setMenuBox] = useState<Box | null>(null); // menu link of the page being explained
  const [pointAt, setPointAt] = useState<string | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const features = useRef<ViewContext['features'] | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const hasBox = box !== null;
  const closed = index === null;
  const step = index === null ? null : TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;
  const activeTarget = pointAt ?? step?.target ?? null;
  // On a page step the menu link that opens that page stays highlighted too.
  const menuTarget = pointAt ? null : (step?.via ?? null);

  const finish = useCallback(() => {
    setAccountMenu(false);
    setIndex(null);
    setBox(null);
    setMenuBox(null);
    setPointAt(null);
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
      features.current = ctx?.features ?? null;
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

  // Replay from the account menu.
  useEffect(() => {
    const onStart = () => {
      started.current = true;
      scrolledFor.current = null;
      getViewContext().then((ctx) => {
        features.current = ctx?.features ?? null;
      });
      setIndex(0);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  // While the tour is open the account menu is not closed by outside clicks
  // (see Header), so it stays open while the tour points at Profile.
  useEffect(() => {
    if (closed) return;
    document.body.dataset.tourActive = '1';
    return () => {
      delete document.body.dataset.tourActive;
    };
  }, [closed]);

  // Go to the next step in `dir` that can be shown: a step whose feature the
  // account lacks, or whose target never appears, is skipped. A step on another
  // page first points at that page's menu link, then opens the page.
  const goTo = useCallback(
    async (from: number, dir: 1 | -1) => {
      setBusy(true);
      let i = from;
      while (i >= 0 && i < TOUR_STEPS.length) {
        const s = TOUR_STEPS[i];
        if (!hasFeature(s, features.current)) {
          i += dir;
          continue;
        }
        if (!s.target) break;
        setAccountMenu(Boolean(s.openMenu));
        if (s.route && window.location.pathname !== s.route) {
          if (s.via && dir === 1 && targetEl(s.via)) {
            scrolledFor.current = null;
            setPointAt(s.via);
            await sleep(POINT_AT_MENU_MS);
            setPointAt(null);
          }
          router.push(s.route);
        }
        if (await waitForTarget(s.target)) break;
        i += dir;
      }
      setBusy(false);
      if (i < 0) i = 0;
      if (i >= TOUR_STEPS.length) return finish();
      if (!TOUR_STEPS[i].target) setAccountMenu(false);
      scrolledFor.current = null;
      setIndex(i);
    },
    [router, finish],
  );

  // Keep the spotlight on its element while the page scrolls, resizes or loads.
  useEffect(() => {
    if (!menuTarget) {
      setMenuBox(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const el = targetEl(menuTarget);
      if (el) {
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        setMenuBox((prev) => (sameBox(prev, next) ? prev : next));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [menuTarget]);

  useEffect(() => {
    if (!activeTarget) {
      setBox(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const el = targetEl(activeTarget);
      if (el) {
        if (scrolledFor.current !== activeTarget) {
          scrolledFor.current = activeTarget;
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
  }, [activeTarget]);

  // The card's height depends on its width (which changes with its placement),
  // so measure after every render; the equality check stops any update loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0;
    setCardHeight((prev) => (prev === h ? prev : h));
  });

  useEffect(() => {
    if (index === null) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape inside a field the user is filling in must not end the tour.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, finish]);

  if (index === null || !step || isPublicPath(pathname)) return null;

  const centered = !activeTarget || !box;
  let cardStyle: React.CSSProperties | undefined;
  if (!centered && box) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(CARD_WIDTH, vw - 2 * EDGE);
    const left = Math.min(Math.max(box.left, EDGE), vw - width - EDGE);
    let top: number;
    if (box.top + box.height + CARD_GAP + cardHeight <= vh - EDGE) top = box.top + box.height + CARD_GAP;
    else if (box.top - CARD_GAP - cardHeight >= HEADER_SAFE) top = box.top - CARD_GAP - cardHeight;
    else top = vh - cardHeight - EDGE; // target too tall: card pinned to the bottom
    cardStyle = { top, left };

    // A tall block would be partly hidden by the card: use the free space beside
    // it when there is enough, so every field and Save button stays reachable.
    const overlaps = top < box.top + box.height && top + cardHeight > box.top;
    const rightSpace = vw - (box.left + box.width) - CARD_GAP - EDGE;
    const leftSpace = box.left - CARD_GAP - EDGE;
    if (overlaps && vw > 640 && Math.max(rightSpace, leftSpace) >= MIN_SIDE_WIDTH) {
      const onRight = rightSpace >= leftSpace;
      const sideWidth = Math.min(CARD_WIDTH, onRight ? rightSpace : leftSpace);
      cardStyle = {
        width: sideWidth,
        left: onRight ? box.left + box.width + CARD_GAP : box.left - CARD_GAP - sideWidth,
        top: Math.min(Math.max(box.top, HEADER_SAFE), Math.max(HEADER_SAFE, vh - cardHeight - EDGE)),
      };
    }
  }

  // Interactive steps leave the highlighted area clickable: four panels around
  // it swallow clicks on the rest of the page instead of one full-screen layer.
  const open = Boolean(step.interactive && box && !pointAt);
  const holeTop = box ? box.top - SPOTLIGHT_PAD : 0;
  const holeLeft = box ? box.left - SPOTLIGHT_PAD : 0;
  const holeWidth = box ? box.width + 2 * SPOTLIGHT_PAD : 0;
  const holeHeight = box ? box.height + 2 * SPOTLIGHT_PAD : 0;
  const panel = (key: string, s: React.CSSProperties) => (
    <div key={key} className={styles.blocker} aria-hidden="true" style={{ right: 'auto', bottom: 'auto', ...s }} />
  );

  const pad = (b: Box): Box => ({ top: b.top - SPOTLIGHT_PAD, left: b.left - SPOTLIGHT_PAD, width: b.width + 2 * SPOTLIGHT_PAD, height: b.height + 2 * SPOTLIGHT_PAD });
  const holes: Box[] = [];
  if (!centered && box) holes.push(pad(box));
  if (menuBox) holes.push(pad(menuBox));

  const progress = Math.round((index / (TOUR_STEPS.length - 1)) * 100);
  const primaryLabel = index === 0 ? 'Start tour' : isLast ? 'Finish' : 'Next';

  return (
    <>
      {open ? (
        [
          panel('t', { top: 0, left: 0, width: '100vw', height: Math.max(0, holeTop) }),
          panel('b', { top: holeTop + holeHeight, left: 0, width: '100vw', height: Math.max(0, window.innerHeight - holeTop - holeHeight) }),
          panel('l', { top: holeTop, left: 0, width: Math.max(0, holeLeft), height: holeHeight }),
          panel('r', { top: holeTop, left: holeLeft + holeWidth, width: Math.max(0, window.innerWidth - holeLeft - holeWidth), height: holeHeight }),
        ]
      ) : (
        <div className={styles.blocker} aria-hidden="true" />
      )}
      <svg className={styles.mask} aria-hidden="true">
        <defs>
          <mask id="tour-hole">
            <rect width="100%" height="100%" fill="#fff" />
            {holes.map((h, i) => (
              <rect key={i} x={h.left} y={h.top} width={h.width} height={h.height} rx="10" fill="#000" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(7, 27, 73, 0.62)" mask="url(#tour-hole)" />
      </svg>
      {holes.map((h, i) => (
        <div
          key={i}
          className={`${styles.spotlight} ${i === 1 ? styles.menuRing : ''}`}
          aria-hidden="true"
          style={{ top: h.top, left: h.left, width: h.width, height: h.height }}
        />
      ))}
      <div
        ref={cardRef}
        className={`${styles.card} ${centered ? styles.centered : ''}`}
        style={cardStyle}
        role="dialog"
        aria-modal={open ? undefined : true}
        aria-labelledby="tour-title"
        data-testid="product-tour"
      >
        <div className={styles.step}>{index === 0 ? 'Quick tour' : isLast ? 'Done' : `Tour · ${progress}%`}</div>
        <h2 id="tour-title" className={styles.title}>
          {step.title}
        </h2>
        <p className={styles.text}>{step.text}</p>
        {step.interactive && <p className={styles.hint}>You can type in the highlighted block right now.</p>}
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
