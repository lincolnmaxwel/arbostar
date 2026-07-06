const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // next-pwa's manifest scraper picks up `app-build-manifest.json` as if it were a
  // publicly servable static asset, but Next.js (App Router) only ever uses it
  // server-side and never exposes it under /_next/. Precaching it causes the
  // Workbox install step to fetch a 404, which fails the entire SW install and
  // makes the browser discard the registration. Exclude it from the precache list.
  buildExcludes: [/app-build-manifest\.json$/],
  // Uploaded photos are served through /api/uploads/... (a route handler
  // reading the current file from disk on every request), not from public/ —
  // `next start` only scans public/ once at boot, so a file written after
  // startup (every real upload) would 404 forever otherwise. Since they never
  // live under public/, there's nothing here for next-pwa to precache/exclude.
  runtimeCaching: [
    {
      // /quotes/new is the ONLY route used to create or edit a draft — the
      // draft id lives entirely in `?draft=<uuid>` (QuoteView's Edit link is
      // `/quotes/new?draft=${draftId}`), and Next appends its own `_rsc` query
      // param on client-side transitions. Every visit is therefore a distinct
      // URL. Without ignoreSearch, Workbox's default NetworkFirst caches per
      // exact URL, so resuming ANY draft (new or existing) offline 404s the
      // first time that specific query string is hit — even though the page
      // is 100% client-rendered from IndexedDB and needs zero network data.
      // ignoreSearch collapses every /quotes/new?* request onto one cache
      // entry so the page shell loads offline regardless of which draft.
      urlPattern: ({ url }) => self.origin === url.origin && url.pathname === '/quotes/new',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'quote-builder',
        matchOptions: { ignoreSearch: true },
        networkTimeoutSeconds: 3,
      },
    },
    {
      // /quotes/<draftId> (the read-only view) and /quotes/<draftId>/booking
      // both carry the draft id in the PATH, not a query string, so
      // ignoreSearch above can't help them the way it helps /quotes/new. The
      // Quotes list links a draft here the moment it has a serverId — which
      // can flip true from a background sync completing (e.g. a brief
      // reconnect) even if the device goes straight back offline before the
      // user clicks back into it — so this exact path was very likely never
      // visited (and thus never cached) before. Both pages are 100%
      // client-rendered from IndexedDB (useParams + Dexie), so — like
      // /quotes/new — which specific draftId is in the cached HTML doesn't
      // matter; a cacheKeyWillBeUsed plugin normalizes the id segment to a
      // fixed placeholder so any draftId's first-ever offline visit still
      // hits a warm cache entry instead of a hard-navigation dead end.
      urlPattern: ({ url }) => {
        if (self.origin !== url.origin) return false;
        const parts = url.pathname.split('/');
        return parts[1] === 'quotes' && !!parts[2] && parts[2] !== 'new';
      },
      handler: 'NetworkFirst',
      options: {
        cacheName: 'quote-view',
        networkTimeoutSeconds: 3,
        plugins: [
          {
            cacheKeyWillBeUsed: async ({ request }) => {
              const url = new URL(request.url);
              const parts = url.pathname.split('/');
              const suffix = parts.length > 3 ? `/${parts.slice(3).join('/')}` : '';
              return `${url.origin}/quotes/__any__${suffix}`;
            },
          },
        ],
      },
    },
    ...require('next-pwa/cache'),
  ],
});

module.exports = withPWA({
  reactStrictMode: true,
});
