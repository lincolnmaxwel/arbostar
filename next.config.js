const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // next-pwa's manifest scraper picks up `app-build-manifest.json` as if it were a
  // publicly servable static asset, but Next.js (App Router) only ever uses it
  // server-side and never exposes it under /_next/. Precaching it causes the
  // Workbox install step to fetch a 404, which fails the entire SW install and
  // makes the browser discard the registration. Exclude it from the precache list.
  buildExcludes: [/app-build-manifest\.json$/],
  // Uploaded photos live under public/uploads and are scanned into the precache
  // manifest at build time along with everything else in public/ — meaning the
  // manifest (and therefore which builds succeed) depends on whatever files
  // happen to be on disk when `next build` runs, and a photo deleted after a
  // build would 404 for anyone still on that build's cached manifest. These are
  // user data fetched on demand, not app shell; exclude them from precaching.
  publicExcludes: ['!uploads/**/*'],
});

module.exports = withPWA({
  reactStrictMode: true,
});
