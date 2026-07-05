const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // next-pwa's manifest scraper picks up `app-build-manifest.json` as if it were a
  // publicly servable static asset, but Next.js (App Router) only ever uses it
  // server-side and never exposes it under /_next/. Precaching it causes the
  // Workbox install step to fetch a 404, which fails the entire SW install and
  // makes the browser discard the registration. Exclude it from the precache list.
  buildExcludes: [/app-build-manifest\.json$/],
});

module.exports = withPWA({
  reactStrictMode: true,
});
