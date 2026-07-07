# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Arbostar: an offline-first quote/estimate builder for a tree service company (single-tenant — one deployment per company, no multi-tenant isolation, no RBAC — every authenticated staff user has equal access to all data). Staff build a quote (client info, priced line items, photos) that must survive filling out a form with no internet and a page reload mid-fill, then send it to the client for approval via a public link. Full design context lives in `docs/superpowers/specs/` and `docs/superpowers/plans/` — the plan file's "Task 15 addendum" and "Post-plan additions" sections document several real bugs found only by production-build/E2E testing; read them before assuming an area is solid.

Stack: Next.js 14 (App Router) + TypeScript, Prisma + PostgreSQL, NextAuth (credentials), Dexie/IndexedDB for offline drafts, nodemailer for client-approval emails, Vitest + Playwright for testing.

## Commands

```bash
npm run dev                  # dev server (localhost:3000)
npm run build                # production build
npm run start                # production server (run build first)
npm run lint                 # next lint

npm test                     # vitest run (all unit + integration tests, needs Postgres up)
npx vitest run <path>         # single test file
npx vitest run -t "<name>"    # single test by name
npm run test:watch           # vitest watch mode

npm run test:e2e             # playwright — builds + starts a real prod server, runs against it
npx playwright test <file>   # single e2e spec

npm run db:migrate           # prisma migrate dev
npm run db:generate          # prisma generate
npm run db:seed              # seeds one admin user: admin@tiptoptreesltd.com / changeme123
npx prisma studio             # inspect DB visually
```

Integration tests hit a real Postgres database (`DATABASE_URL` in `.env`), not a mock — make sure Postgres is running and migrated before `npm test`. E2E tests spin up a real `next build && next start` (see `playwright.config.ts`); if port 3000 is already occupied by a stale server, Playwright's `reuseExistingServer` will silently reuse it instead of building fresh — kill anything on 3000 first if E2E results look stale (a leftover `next dev` server, for one, runs with the service worker disabled entirely, since PWA is `disable: NODE_ENV === 'development'`).

## Architecture

### Offline sync model (the core mechanic)

Every quote in progress is a **draft**, stored client-side in IndexedDB (Dexie, `src/lib/localDb.ts`) — the server (Postgres) never has a copy until the first successful sync. The pipeline:

1. `src/components/QuoteBuilderForm.tsx` holds an in-memory `formState` (authoritative for user-editable fields) alongside `draft` (a live Dexie query). This split exists specifically to avoid data loss: without it, editing two fields within the same debounce window can silently drop one — see the component's top-of-file comments for the exact mechanism.
2. Edits are debounced (500ms) into `localDb.drafts` via `persist()` — a full `.put()` of the whole draft row, not a partial update. **Any field that lives in Dexie but isn't part of the `DraftQuote` type / `formState` gets silently wiped on the next autosave.** This has bitten this codebase twice (`serverId`/`serverItemId` reconciliation, `pendingSend`) — when adding a new draft-level flag, add it to the `DraftQuote` interface (`src/lib/localDb.ts`) so it flows through `formState` naturally, or explicitly reconcile it the way the `serverId`/`serverItemId` effect in `QuoteBuilderForm.tsx` does.
3. "Save" and "Save and Send" both call `enqueueSync()` (`src/lib/outbox.ts`), which queues a draftId in the `outbox` Dexie table. "Save and Send" additionally sets `pendingSend: true` on the draft — a one-shot flag the sync worker reads as `send: true` in its POST body and clears back to `false` once that specific sync completes.
4. `src/lib/syncWorker.ts`'s `runSyncCycle()` (started once from the root layout via `src/components/SyncLoopStarter.tsx`, on an interval + `online` event) drains the outbox: checks real connectivity via `/api/health` (not just `navigator.onLine`, which false-positives), then POSTs to `/api/quotes`. Response handling: success → `synced`; a 409/4xx → `markStuck()` (stop retrying, surface a manual retry/discard banner); network error/5xx → `recordFailure()` (exponential backoff).
5. Server-side (`src/app/api/quotes/route.ts`), the draft is upserted keyed by the client-generated `draftId` (a DB-level unique constraint), so retries can never create duplicate quotes. Line items are reconciled by `localItemId` (matched/updated/created) rather than deleted-and-recreated, so `QuoteItem.id` stays stable across resyncs — this matters because `QuotePhoto` rows cascade-delete with their `QuoteItem`, and photo uploads need a stable server-side item id to attach to (`item.serverItemId`, populated after the first successful text sync).
6. Photos are captured offline too (`src/lib/photoSync.ts`): `addPhotoToItem()` writes only the blob to `localDb.photos` and returns an id — it deliberately does **not** touch `localDb.drafts` itself, to avoid a stale-read/overwrite race with the form's own debounced save. The caller merges the returned id into `formState` through the normal update path. Actual upload to the server (`uploadPendingPhotos()`) only happens once the parent item has a `serverItemId`, and is guarded by a Dexie transaction against double-upload (relevant because `reactStrictMode: true` double-invokes effects in dev).

### Draft identity lives in the URL, not localStorage

`/quotes/new` mints a fresh `draftId` and redirects to `/quotes/new?draft=<uuid>` only when no `draft` param is present. This was **not** the original design — an earlier version persisted the draft id in a global `localStorage` key so a reload would resume the same draft, which fixed reload-safety but meant a browser could only ever create one quote, ever (every "New quote" click resumed the first, and resending it overwrote the first customer's already-synced quote). Keep draft identity keyed by URL param, not global client storage.

### Uploaded files: never write into `public/`

Photos are written to a top-level `uploads/` directory (project root, **not** `public/uploads/`) and served through `src/app/api/uploads/quotes/[quoteId]/[filename]/route.ts` — a route handler that reads the current file from disk on every request. This is deliberate: `next start` only scans the `public/` directory once at process boot, so any file written after the server is already running (i.e. every real upload) 404s until the whole app is restarted. Verified directly: dropping an arbitrary file into `public/` while a prod server was running returned 404 before a restart, 200 after. Any future runtime-generated file needs the same route-handler treatment, not a `public/` path.

### Client approval portal (public, unauthenticated)

`/portal/[token]` (a Server Component) and `POST /api/portal/[token]/respond` are intentionally outside `src/middleware.ts`'s matcher (`/quotes/:path*` only) and carry no session check — the long random `Quote.publicToken` (a UUID) is the only credential. A quote's `status` moves `draft` → `sent` ("Pending" in the UI) the moment "Save and Send" first syncs it (triggers `sendQuoteApprovalEmail()`, `src/lib/email.ts`, itemized proposal + portal link); the client's Approve/Decline sets `approved`/`declined` and is idempotent (repeat clicks don't re-flip an already-decided quote). `client.upsert`'s `update` clause keeps `name`/`phone`/`address` in sync with whatever the most recent save sent (matched by email, which itself is never changed by an update) — a plain edit to client details, or a resend, both update the shared `Client` row. This used to be a no-op `update: {}` "by design," but that silently reverted any client-detail edit the moment cross-device sync (`pullServerQuotes()`) refreshed the draft from the server's still-stale copy — fixed rather than documented around.

Email SMTP config is env-driven (`SMTP_HOST`/`PORT`/`SECURE`/`USER`/`PASS`/`FROM`) — swapping providers (Ethereal for local dev, Gmail app-password, etc.) is a `.env` change only, no code changes.

The client-facing portal's "From" party block (company name/phone/email/address + logo) reads `CompanyProfile`, a singleton row (`src/lib/companyProfile.ts`, always keyed by the fixed id `'company'`, not a generated uuid — one deployment is one company). Edited from `/profile` (`GET`/`PATCH /api/company`); the logo is uploaded via `POST /api/company/logo` and — like quote photos — written to a top-level `uploads/company/` directory and served through `/api/uploads/company/[filename]/route.ts`, not `public/`, for the same "next start only scans public/ once at boot" reason. Uploading a new logo deletes the previous file so orphaned images don't accumulate.

### Staff notifications (profile page)

`/profile` (session-protected, in `middleware.ts`'s matcher) lets a user change their password (`POST /api/profile/password`, verifies `currentPassword` via bcrypt before hashing the new one) and set `User.notificationEmail` (`GET`/`PATCH /api/profile`) — where client-response emails go, separate from their login email; null falls back to the login email. Both `/api/portal/[token]/respond` (approve/decline) and `/api/portal/[token]/booking/respond` (confirm/reject a proposed date) send a notification to `quote.createdBy.notificationEmail || quote.createdBy.email` after the status change commits, wrapped in try/catch the same way the client-facing emails are — a notification failure never turns a successful client action into a 5xx. The header's user-email dropdown (Profile / Sign out) reads the session via `useSession()` inside a client-side `<SessionProvider>` (`src/components/Providers.tsx`), not `getServerSession()` in the root layout — the layout doesn't re-render on the client-side navigation after login, so a server-fetched session there stays stuck at "logged out" until a hard reload. `SessionProvider` also avoids forcing every route dynamic, which `getServerSession()` in the root layout did (Next marks the whole tree dynamic once a layout reads cookies), undoing the SW's ability to treat `/quotes` and `/quotes/new` as static.

### Clients and Invoices (staff-facing, server-truth only — no offline drafting)

`/clients` lists only clients with at least one `scheduled`- or `completed`-status quote (`getConfirmedClients()`, `src/lib/clients.ts`) — a client with only draft/sent/declined quotes doesn't count as a "real" client yet. The same query backs `GET /api/clients`, which the new-quote form's client picker (`QuoteBuilderForm.tsx`) fetches once on mount so a repeat customer's name/email/phone/address can be selected instead of retyped — selecting one does a single merged `setFormState`/`persist()` call, not four sequential `updateField()` calls, since `updateField` reads `formState` from the render closure and four calls in a row would each overwrite the last (the same multi-field-edit race `persist()`'s design already guards against elsewhere).

Marking a `scheduled` quote **Completed** (button on `QuoteView`, `POST /api/quotes/[id]/complete`) flips `Quote.status` to `completed` and creates its one-and-only `Invoice` in the same transaction — a frozen snapshot of the quote's totals at that moment (not a live recompute), so a later edit to the by-then-completed quote can't silently change an invoice the client already received by email (`sendInvoiceEmail`, `src/lib/email.ts`). `/invoices` and `/invoices/[id]` list/display them.

The invoice email carries a PDF attachment (`buildInvoicePdf()`, `src/lib/invoicePdf.ts`, A4 layout mirroring `/invoices/[id]`) generated with `pdfkit` — chosen over a headless-browser HTML-to-PDF approach (Puppeteer/Playwright) specifically to avoid bundling Chromium into the Alpine Docker deploy image (see the Prisma OpenSSL note above for the last time an Alpine-native-binary mismatch bit this project). **`pdfkit` must stay listed in `next.config.js`'s `experimental.serverComponentsExternalPackages`.** It loads its built-in font metrics (`Helvetica.afm` etc) via a path relative to its own `__dirname` at runtime; webpack bundling the route handler rewrites `__dirname` to the bundle's own emitted location instead of pdfkit's real package directory, breaking that lookup with an ENOENT that's silently swallowed by `complete/route.ts`'s own try/catch (the request still 201s — the email just quietly ships with no PDF). Only caught by grepping the server log for the actual ENOENT after a real prod build + `next start`, not by any test.

**Both `/clients` and `/invoices` (and `/invoices/[id]`) declare `export const dynamic = 'force-dynamic'`.** A raw Prisma call gives Next.js's static-analysis no "dynamic" signal the way `fetch()` does — without this, Next silently prerenders the page ONCE at build time and serves that same stale snapshot to every request forever, so a new confirmed client or invoice would never appear without a full redeploy. Caught by inspecting the build output (`○` vs `ƒ` markers), not by anything failing loudly. Any future server-component page that queries Prisma directly (rather than being a `'use client'` page fetching from an API route, like the Dexie-backed `/quotes` pages) needs the same directive.

Deleting: `DELETE /api/invoices/[id]` and `DELETE /api/clients/[id]` (buttons on `/invoices`, `/invoices/[id]`, `/clients`) exist mainly so staff (and whoever's testing) can reset state without going through Postgres directly. `Quote.client` cascades (deleting a `Client` deletes all their quotes, and transitively items/photos/schedule rounds) but `Invoice.quote` deliberately does NOT — an invoice is a record the client already received by email, so it should never vanish as a side effect of deleting the quote or client it's attached to. Deleting a client (or a quote) that still has an invoice fails with a 409 (`{ error: 'has-invoice' }`, not a raw Postgres FK-violation 500) telling staff to delete the invoice first — the order the request above described.

### Data model notes

- `Quote.status` enum: `draft | sent | approved | declined | expired | scheduled | completed`. `sent` is the client-facing "Pending" state.
- Two independent status axes on `DraftQuote`: `status` (`local|syncing|synced|error`, whether THIS DEVICE's copy has reached the server) vs `approvalStatus`/`bookingStatus` (the quote's business status server-side). The Quotes list (`src/app/quotes/page.tsx`) shows the sync-status badge only while `status !== 'synced'`; once synced, it shows `QuoteStatusBadge` (`src/lib/quoteStatusLabel.ts`) instead — "Synced" stops being the interesting fact once true, and staff care whether it's pending the client's approval, pending scheduling, approved, declined, etc. `approvalStatus`/`bookingStatus` are populated by `pullServerQuotes()` (periodic pull) and immediately by `syncWorker.ts` on a successful POST response, so they don't wait for the next pull cycle after a Save.
- `Client.email` is unique — client resolution is `upsert`, not a racy find-then-create.
- `Quote.serviceAddress` (where the work happens) lives on the Quote, not the Client — `Client.phone`/`Client.address` are the client's own contact info, but the same client can request quotes for different properties. The builder form's Client phone field masks input to `(xxx) xxx-xxxx` client-side (`src/lib/formatPhone.ts`) as the user types; the stored value is the masked string itself, not raw digits.
- Money/rate fields are Prisma `Decimal`; convert with `Number(x)` before arithmetic or JSON responses.
- Scope note: this is sub-project 1 of a larger system. Client portal, scheduling, and invoicing are now built; anything beyond `Invoice` (payment tracking/reconciliation, accounting export, etc.) is still a separate, not-yet-built sub-project per the original spec.

### Testing conventions

- Integration tests (`tests/integration/`) mock `next-auth`'s `getServerSession` via `vi.mock('next-auth', ...)` but hit a real Postgres DB through Prisma — clean up created rows in `afterAll`. **For a singleton row keyed by a fixed id (`CompanyProfile`, id `'company'` — not a per-test `randomUUID()` row like everything else), never `deleteMany`/`rmSync` it away in `beforeEach`/`afterAll`: that fixed id is the SAME row a real deployment's `/profile` page edits, so a careless cleanup wipes real company data (name/phone/address, and any uploaded logo file) every time the suite runs against a dev DB with real data in it — which happened once while building `tests/integration/company-api.test.ts`.** The fix that test now uses: snapshot the existing row (and the real files already in `uploads/company/`) in `beforeAll`, `upsert` a blank slate in `beforeEach` (never delete), and restore the exact snapshot in `afterAll`.
- Component tests needing `createObjectURL`/`clipboard`/etc. stub them directly (jsdom doesn't implement these) — see `tests/unit/QuoteView.test.tsx` for the pattern.
- `tests/e2e/offline-quote.spec.ts` paces field edits ~600ms apart (`page.waitForTimeout`) to clear the 500ms autosave debounce deterministically before the next action.

### Github

- Sempre que realizar alterações no sistema, deve realiar o commit dessas alteracoes para o repo https://github.com/lincolnmaxwel/arbostar e na sequencia realiazr o push para branch master.

### Idioma

Qualquer texto que for adicionado ao sistema precisa ser em ingles. Mesmo eu pedindo em portugues, faça a tradução e deixe todo o texto para o usuario em ingle