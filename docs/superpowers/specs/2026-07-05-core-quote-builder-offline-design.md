# Design: Core Data Model + Quote Builder (Offline-First)

Status: approved
Date: 2026-07-05
Sub-project 1 of 4 in the Arbostar-style quoting system.

## Context

Client (Tip Top Tree Service, and future similar clients — single-tenant per
deployment) needs a system to build quotes/estimates (services, prices,
photos, client info), send them for client approval, convert approved quotes
to orders, schedule work, and invoice on completion.

This spec covers only **sub-project 1**: the internal-facing data model and
quote builder, with the offline-first requirement. Later sub-projects (each
gets its own spec):

2. Client-facing approval portal (public link, approve/decline, emails)
3. Order conversion + scheduling (proposed dates, client picks one)
4. Job completion + invoice generation (PDF)

## Requirements driving this design

- Staff reported: existing tool loses in-progress quote data when the
  connection drops mid-fill and the page reloads. This system must never
  lose a draft, and the quote-builder page itself must open even with no
  network.
- Multiple staff log in with role-based access (admin/staff), single tenant.
- Photos, line items (service + description + price), client selection.

## Architecture

- Next.js 14+ (App Router), TypeScript, single deployable process.
- Postgres + Prisma ORM.
- NextAuth (credentials) for staff login; roles: `admin`, `staff`.
- PWA: web app manifest + service worker (Workbox) precaches the app shell
  (HTML/JS/CSS) at install time, so the quote-builder route loads with no
  network on repeat visits.
- IndexedDB (via Dexie) is the local source of truth for in-progress quotes.
- "Outbox" pattern reconciles local drafts with the server once connectivity
  is confirmed.
- Photos stored on local VPS disk (`/uploads/quotes/{quoteId}/`), served
  statically; DB stores file paths only.

## Data model (Prisma)

```
User        { id, name, email, passwordHash, role[admin|staff] }
Client      { id, name, email, phone, address }
ServiceCatalogItem { id, name, defaultPrice }        // reusable service presets
Quote       { id, number, revision, status[draft|sent|approved|declined|expired],
              clientId, createdById, subtotal, taxRate, taxAmount, total,
              sentAt, respondedAt, publicToken, createdAt, updatedAt }
QuoteItem   { id, quoteId, title, description, price, sortOrder }
QuotePhoto  { id, quoteItemId, filePath, sortOrder }
AuditLog    { id, entityType, entityId, action, actorId, createdAt }
```

Notes:
- `publicToken` (long UUID) is the future basis for the client portal link
  (sub-project 2); generated at quote creation even though the portal itself
  is out of scope here.
- Schema favors nullable/optional fields and small, focused tables so future
  fields (warranty, per-quote terms, discounts, etc.) can be added via normal
  Prisma migrations without reshaping existing tables.
- `Order`, `ScheduleOption`, `Invoice` tables belong to sub-projects 3–4 and
  are not created in this phase, but `Quote.status` already reserves the
  states (`approved`) they'll key off of.

## Offline-first mechanism

1. Opening the builder creates a client-generated `draftId` (UUID) — no
   server round-trip needed to start editing.
2. Every change (debounced 500ms) writes a full draft snapshot to Dexie
   (`drafts` table) synchronously, no network involved.
3. Photos become Blobs, resized/compressed client-side, stored in Dexie
   (`draftPhotos`) keyed by `draftId`.
4. Pressing "Save"/"Send" enqueues an outbox record:
   `{ type: 'upsertQuote', draftId, payload, attempts, lastError }`.
5. A background sync worker (interval + `online` event listener):
   - Confirms real connectivity via a HEAD request to the server (not just
     `navigator.onLine`, which false-positives).
   - Drains the outbox in order; POST is idempotent server-side, deduped by
     `draftId` so retries never create duplicate quotes.
   - On success: removes from outbox, marks draft synced, stores `serverId`.
   - On failure: exponential backoff (1s → 60s cap), stays queued.
6. On reload/crash mid-edit: IndexedDB persists, so reopening the builder
   auto-restores the unsynced draft without prompting — this directly
   addresses the reported data-loss complaint.
7. Photo uploads go over a separate multipart request and don't block the
   rest of the quote's sync.
8. UI: every quote (in the builder and in the list view) shows a visible
   status badge — "Local" vs "Synced" — sourced from IndexedDB so it renders
   even offline.

## Error handling / edge cases

- **Concurrent edit conflict**: optimistic locking on `updatedAt`; server
  rejects stale writes, client shows "this quote changed on the server,
  please review" instead of silently overwriting.
- **Real (non-network) errors** (4xx): outbox stops auto-retrying that
  record, surfaces a visible "sync error" state with manual retry/discard.
- **IndexedDB storage pressure**: photos are resized/compressed client-side
  before local storage.
- **App update mid-sync**: new service worker version does not evict the
  old cache until the outbox is empty, so an unsynced draft is never
  orphaned by a deploy.

## Testing

- Unit: outbox reducer (enqueue/dedupe/backoff), subtotal/tax/total math.
- Integration: API routes against a test Postgres DB — create/edit quote,
  photo upload, dedupe-by-`draftId`.
- E2E offline (Playwright, `context.setOffline(true)`): fill form offline,
  reload mid-fill, go back online, verify auto-sync with zero data loss.
- Manual: real network throttling/disconnection during active use.
