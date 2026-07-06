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
});

module.exports = withPWA({
  reactStrictMode: true,
});
