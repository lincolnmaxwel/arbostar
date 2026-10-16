/**
 * Forget what the service worker and the browser cached for the account that
 * is signing out. Offline, `/api/*` GETs fall back to the SW's shared 'apis'
 * cache (URL-keyed, not per user), and the service-catalog shortcuts live in
 * one localStorage key, so without this a different person signing in on the
 * same device could be shown the previous account's cached data.
 * Local quote drafts are not touched: they are namespaced by owner already.
 */
/** Email of the last signed-in user, so the header menu survives an offline reload. */
export const LAST_EMAIL_KEY = 'arbostar-last-email';

export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key === 'apis').map((key) => caches.delete(key)));
    }
  } catch {
    // best effort
  }
  try {
    window.localStorage.removeItem('arbostar-service-catalog');
    window.localStorage.removeItem(LAST_EMAIL_KEY);
    // Timesheet form lists cached per account (clients, services, hourly rate).
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('arbostar-ts-')) window.localStorage.removeItem(key);
    }
  } catch {
    // best effort
  }
}
