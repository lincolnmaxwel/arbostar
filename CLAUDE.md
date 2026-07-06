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

`/portal/[token]` (a Server Component) and `POST /api/portal/[token]/respond` are intentionally outside `src/middleware.ts`'s matcher (`/quotes/:path*` only) and carry no session check — the long random `Quote.publicToken` (a UUID) is the only credential. A quote's `status` moves `draft` → `sent` ("Pending" in the UI) the moment "Save and Send" first syncs it (triggers `sendQuoteApprovalEmail()`, `src/lib/email.ts`, itemized proposal + portal link); the client's Approve/Decline sets `approved`/`declined` and is idempotent (repeat clicks don't re-flip an already-decided quote). Client details never update on a resend (`client.upsert` with an empty `update: {}`) — this is a known, accepted simplification, not a bug.

Email SMTP config is env-driven (`SMTP_HOST`/`PORT`/`SECURE`/`USER`/`PASS`/`FROM`) — swapping providers (Ethereal for local dev, Gmail app-password, etc.) is a `.env` change only, no code changes.

### Data model notes

- `Quote.status` enum: `draft | sent | approved | declined | expired`. `sent` is the client-facing "Pending" state.
- `Client.email` is unique — client resolution is `upsert`, not a racy find-then-create.
- Money/rate fields are Prisma `Decimal`; convert with `Number(x)` before arithmetic or JSON responses.
- Scope note: this is sub-project 1 of a larger system (client portal is included; order/scheduling conversion and invoicing are separate, not-yet-built sub-projects per the original spec).

### Testing conventions

- Integration tests (`tests/integration/`) mock `next-auth`'s `getServerSession` via `vi.mock('next-auth', ...)` but hit a real Postgres DB through Prisma — clean up created rows in `afterAll`.
- Component tests needing `createObjectURL`/`clipboard`/etc. stub them directly (jsdom doesn't implement these) — see `tests/unit/QuoteView.test.tsx` for the pattern.
- `tests/e2e/offline-quote.spec.ts` paces field edits ~600ms apart (`page.waitForTimeout`) to clear the 500ms autosave debounce deterministically before the next action.

### Github

- Sempre que realizar alterações no sistema, deve realiar o commit dessas alteracoes para o repo https://github.com/lincolnmaxwel/arbostar e na sequencia realiazr o push
