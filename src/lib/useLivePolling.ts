import { useEffect, useRef } from 'react';

/**
 * Keep a screen "live": run `fn` immediately, then every `intervalMs` while the
 * tab is visible, and again as soon as the tab regains focus. Calls never
 * overlap, and a rejected call is ignored so one network blip does not stop
 * the loop.
 */
export function useLivePolling(fn: () => unknown | Promise<unknown>, intervalMs: number): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let stopped = false;
    let inflight = false;

    const run = async () => {
      if (stopped || inflight || document.hidden) return;
      inflight = true;
      try {
        await fnRef.current();
      } catch {
        // keep polling
      } finally {
        inflight = false;
      }
    };

    run();
    const timer = setInterval(run, intervalMs);
    const onWake = () => {
      if (!document.hidden) run();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [intervalMs]);
}
