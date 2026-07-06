# Design: Booking / Scheduling (Post-Approval Date Proposal)

Status: approved
Date: 2026-07-05
Sub-project 3 of 4 in the Arbostar-style quoting system.

## Context

Sub-projects 1 (offline-first quote builder) and 2 (client approval portal +
emails) are shipped. When a client approves an estimate, staff currently have
no in-app way to schedule the actual work — scheduling happens out-of-band
(phone, separate email thread). This sub-project closes that gap: after
approval, staff propose up to 3 date+window options per round through the
staff app; the client receives an email pointing back to the same public
portal link, which now renders a date picker instead of the approve/decline
UI. The client either confirms one option (quote becomes `scheduled`) or
rejects all with a reason; staff see the reason and can propose a new round.
Iteration repeats until a date is confirmed.

This sub-project is intentionally narrow:

- No `Order`/`Job` entity yet (deferred to sub-project 4 — job completion +
  invoice generation). Confirming a date only flips `Quote.status` to
  `scheduled` and stamps `scheduledDate`/`scheduledWindow`.
- No offline-first requirement. Booking happens post-approval, when staff
  are online. Drafts/Dexie/outbox are not involved; all booking state lives
  in Postgres and is mutated through server routes.

## Requirements driving this design

- Staff need an in-app path from "client approved" to "job is on the
  calendar" without leaving the system.
- Tree-service work is rarely date-exact; clients need flexibility to pick
  between a few offered day-windows (morning / afternoon / full day).
- Dates rarely line up on the first proposal — staff must be able to
  re-propose after a rejection, seeing the client's stated reason.
- The client must not be asked to register or log in — the existing
  `publicToken` link is the only credential, same as the approval flow.

## Architecture

- All booking state lives in Postgres via Prisma. No Dexie/outbox.
- Two new tables (`ScheduleRound`, `ScheduleOption`) hang off `Quote`.
- Three new fields on `Quote` (`bookingStatus`, `scheduledDate`,
  `scheduledWindow`) track the booking sub-state and the final confirmed
  date.
- One new enum value on `QuoteStatus` (`scheduled`); three new enums
  (`BookingStatus`, `DayWindow`, `ScheduleRoundStatus`).
- Staff booking UI lives in a dedicated route `/quotes/[draftId]/booking`
  under the existing `/quotes/:path*` middleware (session-protected).
- Client booking UI lives in the existing `/portal/[token]` page, rendered
  conditionally based on `Quote.status` + `bookingStatus`. Same link, same
  route, no new public routes.
- One new email function `sendBookingProposalEmail` in `src/lib/email.ts`;
  reuses the existing SMTP transporter and `portalUrl` (the `publicToken`
  link, unchanged).

## Data model (Prisma additions)

```prisma
enum QuoteStatus {
  draft
  sent
  approved
  declined
  expired
  scheduled        // NEW — booking confirmed
}

enum BookingStatus {
  idle             // approved, no round proposed yet
  proposed         // a round is awaiting client response
  rejected         // client rejected the latest round with a reason
  confirmed        // client confirmed an option — terminal
}

enum DayWindow {
  morning
  afternoon
  fullday
}

enum ScheduleRoundStatus {
  proposed
  rejected
  confirmed        // an option on this round was chosen
}

model Quote {
  // ...existing fields unchanged...
  bookingStatus    BookingStatus  @default(idle)
  scheduledDate    DateTime?      // set when bookingStatus=confirmed
  scheduledWindow  DayWindow?     // set alongside scheduledDate
  rounds           ScheduleRound[]
}

model ScheduleRound {
  id              String              @id @default(uuid())
  quoteId         String
  quote           Quote               @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  roundNumber     Int
  status          ScheduleRoundStatus @default(proposed)
  rejectionReason String?
  proposedAt      DateTime            @default(now())
  respondedAt     DateTime?
  options         ScheduleOption[]

  @@unique([quoteId, roundNumber])
}

model ScheduleOption {
  id           String         @id @default(uuid())
  roundId      String
  round        ScheduleRound  @relation(fields: [roundId], references: [id], onDelete: Cascade)
  proposedDate DateTime       @db.Date
  window       DayWindow
  chosen       Boolean        @default(false)

  @@unique([roundId, proposedDate, window])
}
```

### Notes

- `scheduledDate`/`scheduledWindow` on `Quote` are denormalized mirrors of
  the chosen `ScheduleOption`. They exist so the staff quote list can show
  "Scheduled: Jul 15 · Morning" without a join. The source of truth remains
  `ScheduleOption.chosen = true` on the confirmed round; the mirrors are
  written in the same transaction that flips the option.
- `proposedDate` is `@db.Date` (no time component) — windows carry the
  time-of-day semantics.
- `@@unique([roundId, proposedDate, window])` prevents a staff typo from
  submitting the same date+window twice in one round.
- `@@unique([quoteId, roundNumber])` lets the API compute
  `roundNumber = max(roundNumber) + 1` per quote safely; two concurrent
  new-round POSTs would race, but the pre-condition
  `bookingStatus in {idle, rejected}` serializes them at the application
  layer (only one such state is reachable at a time per quote).

## State machine

The booking sub-flow activates only while `Quote.status === 'approved'`.
Entry: the moment the client approves the estimate (existing
`POST /api/portal/[token]/respond` flips `status` to `approved`). Exit:
`Quote.status` flips to `scheduled` on confirmation.

```
Quote.status=approved, bookingStatus=idle
   │ staff POST /api/quotes/[id]/booking/round  (round 1)
   ▼
bookingStatus=proposed  ── sendBookingProposalEmail ──▶ portal renders BookingPicker
   │
   ├── client POST /api/portal/[token]/booking/respond
   │        { decision: 'confirm', optionId }
   │     └─▶ bookingStatus=confirmed, Quote.status=scheduled,
   │          scheduledDate/Window mirrored from chosen option,
   │          ScheduleRound.status=confirmed, option.chosen=true
   │          (TERMINAL — no path back)
   │
   └── client POST /api/portal/[token]/booking/respond
            { decision: 'reject', reason }
        └─▶ bookingStatus=rejected, ScheduleRound.status=rejected,
             rejectionReason=reason, respondedAt=now
               │
               │ staff POST /api/quotes/[id]/booking/round  (round N+1)
               ▼
           bookingStatus=proposed  (back to top of loop)
```

### Invariants

- `bookingStatus` only transitions while `Quote.status === 'approved'` (the
  loop body) or on the terminal transition to `scheduled`. It never moves
  backward from `confirmed`/`scheduled`.
- At most one `ScheduleRound` with `status = 'proposed'` exists per quote at
  a time. Creating a new round requires `bookingStatus in {idle, rejected}`
  — `idle` for round 1, `rejected` for round N+1.
- `scheduledDate`/`scheduledWindow` are written only on the
  `proposed → confirmed` transition and never updated afterward.
- `roundNumber` is `max(roundNumber) + 1` per quote, never global.
- The portal respond endpoint is idempotent: a repeat click after
  confirmation/rejection returns the current state without re-flipping
  anything (mirrors the existing `respond/route.ts` pattern).

## Staff UI

### `QuoteView` (existing `src/components/QuoteView.tsx`)

Gains a conditional booking-status area rendered when
`quote.status === 'approved'` OR `quote.status === 'scheduled'`. When
`approved`, it is an actionable button; when `scheduled` (i.e.
`bookingStatus === 'confirmed'`), it is read-only info text.

| `bookingStatus` | Button label | Behavior |
|---|---|---|
| `idle` | "Schedule" | Click → `router.push('/quotes/[draftId]/booking')` |
| `proposed` | "Booking pending" (disabled) | Shows "Awaiting client response" |
| `rejected` | "Re-propose dates" | Click → same route, page surfaces rejection reason |
| `confirmed` | (info-only, not a button) | "Scheduled: Jul 15 · Morning" |

### New page `/quotes/[draftId]/booking/page.tsx`

Client component, session-protected via the existing
`/quotes/:path*` middleware matcher (no new auth work).

Layout:

- Header: quote number + current booking state.
- If `bookingStatus === 'rejected'`: a callout box showing the latest
  rejected round's `rejectionReason` and `respondedAt`, so staff adjust
  before proposing again.
- Form: 1–3 rows of `{ date: <date input>, window: <select> }`.
  - "Add date" button appends a row, capped at 3.
  - Each row has a remove button.
  - Client-side validation:
    - At least 1 row with both fields filled.
    - `date >= today` (no past dates).
    - No two rows with identical `{date, window}` (matches the DB
      `@@unique`).
- Submit → `POST /api/quotes/[id]/booking/round` with
  `{ options: [{ date: 'YYYY-MM-DD', window }, ...] }`.
  - On success: `router.refresh()` then redirect to
    `/quotes/[draftId]` — `QuoteView` now shows "Booking pending".
  - On 409 (a round is already `proposed` / `confirmed`): show banner
    "A booking round is already awaiting response" and disable the form.
  - On network error: show "Couldn't reach server — try again" banner;
    no local persistence (staff online, retry is cheap).

No Dexie, no outbox. This page is a thin React form over two server
endpoints.

## Portal UI (public, same link)

### `PortalPage` (`src/app/portal/[token]/page.tsx`)

Existing Server Component. Extended to fetch the active round (if any)
alongside the quote, and conditionally render:

| `Quote.status` | `bookingStatus` | Renders |
|---|---|---|
| `sent` | n/a | Existing `<PortalActions>` (approve/decline) |
| `approved` | `idle` | Static "Staff will propose scheduling dates shortly" |
| `approved` | `proposed` | New `<BookingPicker>` (replaces `<PortalActions>`) |
| `approved` | `rejected` | "Staff will propose new dates shortly" (transient — staff sees reason in-app) |
| `approved` | `confirmed` | Banner "Job scheduled for <date> · <window>" |
| `scheduled` | `confirmed` | Same banner (post-terminal view of the quote) |

### `<BookingPicker>` component

Props: `{ token: string; roundId: string; options: { id, proposedDate, window }[] }`.

- Radio-card list of options: "Tuesday, Jul 15 · Morning", etc. Dates
  formatted via `toLocaleDateString` for the client's locale.
- Primary CTA "Confirm date" → `POST /api/portal/[token]/booking/respond`
  with `{ decision: 'confirm', optionId }`.
- Secondary "Reject all" → reveals a required textarea (min 3 chars) →
  submit with `{ decision: 'reject', reason }`.
- Submission states: loading spinner on the clicked button, error banner
  on non-2xx. On success: `router.refresh()` — server re-renders the
  appropriate post-decision view above.

## API routes (new)

### `POST /api/quotes/[id]/booking/round` (session-protected)

Body schema (Zod):

```ts
{
  options: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      window: z.enum(['morning', 'afternoon', 'fullday']),
    })
  ).min(1).max(3)
}
```

Flow:

1. `getServerSession` — 401 if no session.
2. Load quote by `id`. 404 if missing.
3. Pre-condition: `quote.status === 'approved'` AND
   `quote.bookingStatus in {idle, rejected}`. Otherwise 409
   `{ error: 'round-already-active' | 'already-scheduled' }`.
4. `roundNumber = (max roundNumber for quote) + 1` (default 1).
5. Prisma transaction:
   - Create `ScheduleRound` (status=`proposed`, roundNumber, proposedAt=now).
   - Create `ScheduleOption`s from the body.
   - Update `Quote.bookingStatus = 'proposed'`.
6. Load client + options for email; call
   `sendBookingProposalEmail({ to: client.email, clientName, portalUrl,
   roundNumber, options })`.
   - Email failure is logged but does NOT roll back the round — the
     staff user can still resend by clicking a "Resend email" action
     (out of scope for this sub-project; the round is already in the
     DB and the client can be pointed to the link manually). Logged
     here so a future sub-project can add a resend affordance.
7. Return `{ roundId }`.

Idempotency: a duplicate POST (e.g. double-click) hits the pre-condition
check — by the time the second request runs, `bookingStatus` is already
`proposed`, so it returns 409 without creating a second round.

### `POST /api/portal/[token]/booking/respond` (public, no session)

Body schema (Zod):

```ts
z.object({
  decision: z.enum(['confirm', 'reject']),
  // required when decision='reject', ignored otherwise
  reason: z.string().min(3).optional(),
}).refine(d => d.decision === 'confirm' || (d.reason ?? '').length >= 3, {
  message: 'reason required when rejecting',
});
```

Flow:

1. Load quote by `publicToken`. 404 if missing.
2. Pre-condition: `quote.status === 'approved'` AND
   `quote.bookingStatus === 'proposed'`. Otherwise return
   `{ status: quote.status, bookingStatus: quote.bookingStatus }`
   idempotently (200, not an error) — mirrors existing
   `respond/route.ts` so a refresh/double-click after deciding doesn't
   surface a confusing failure.
3. Load the active `ScheduleRound` (the one with `status = 'proposed'`,
   which is unique per quote per the state machine). 404 if missing
   (defensive — would indicate a bug).
4. **`confirm`**: validate `optionId` belongs to the active round.
   - Transaction: set `ScheduleOption.chosen = true` on that option,
     `ScheduleRound.status = 'confirmed'`, `respondedAt = now`,
     `Quote.bookingStatus = 'confirmed'`, `Quote.status = 'scheduled'`,
     `Quote.scheduledDate = option.proposedDate`,
     `Quote.scheduledWindow = option.window`.
   - Return `{ status: 'scheduled', bookingStatus: 'confirmed' }`.
5. **`reject`**: validate `reason` is present (Zod refine already
   enforces, but defense-in-depth).
   - Transaction: `ScheduleRound.status = 'rejected'`,
     `rejectionReason = reason`, `respondedAt = now`,
     `Quote.bookingStatus = 'rejected'`. Do NOT change `Quote.status`
     (stays `approved`) — the quote is still approved, just awaiting a
     new round.
   - Return `{ status: 'approved', bookingStatus: 'rejected' }`.

No client-side email is sent from this endpoint. The client made the
decision; staff will see it on their next view/refresh of the quote
(a future sub-project may add staff push notifications; out of scope
here).

## Email (new function in `src/lib/email.ts`)

```ts
export interface SendBookingProposalEmailOptions {
  to: string;
  clientName: string;
  portalUrl: string;
  roundNumber: number;
  options: { date: string; window: 'morning' | 'afternoon' | 'fullday' }[];
}

export async function sendBookingProposalEmail(
  opts: SendBookingProposalEmailOptions
): Promise<void>;
```

- HTML + text bodies, reusing `getTransporter()`, `escapeHtml()`, and the
  Ethereal preview-URL log already in `email.ts`.
- Subject: `Scheduling options for your approved estimate` — distinct
  from the approval email's subject so the two threads don't collapse in
  the client's inbox.
- Body: short intro referencing the approved estimate, a list of
  date+window options formatted as cards (`Tuesday, Jul 15 — Morning`),
  and a single CTA button linking to `portalUrl` (unchanged from the
  approval email's link — same `publicToken`).
- Does NOT repeat the line-item breakdown — the client already approved
  those; only the dates matter here.

## Testing

### Unit (`tests/unit/`)

- `BookingForm.test.tsx` (the staff form on `/quotes/[draftId]/booking`):
  - Renders 1 empty row by default; "Add date" appends up to 3; cap
    disables the button at 3.
  - Submit disabled when 0 rows filled.
  - Past date → validation error, blocks submit.
  - Two rows with same `{date, window}` → validation error.
  - Successful POST → calls `router.push` back to the quote view.
  - 409 response → renders "round already active" banner.
- `BookingPicker.test.tsx` (the public picker):
  - Renders one radio card per option.
  - Selecting an option + Confirm → fetch with correct body.
  - "Reject all" → textarea appears, submit blocked until ≥3 chars.
  - Loading state on the clicked button; error banner on 500.
  - jsdom doesn't implement `fetch` natively — stub via `vi.stubGlobal`
    (follow `QuoteView.test.tsx` pattern).

### Integration (`tests/integration/`)

Hit real Postgres via Prisma; mock `next-auth`'s `getServerSession` and
mock `src/lib/email` to capture calls without sending real SMTP.

- `bookingRound.api.test.ts`:
  - Seed: admin user + client + `Quote` with `status='approved'`,
    `bookingStatus='idle'`.
  - POST valid body → 200, round + options created, `bookingStatus`
    flips to `proposed`, `sendBookingProposalEmail` called once with
    the right options/portalUrl.
  - POST again without a client response → 409
    (`round-already-active`), no new rows.
  - POST with `bookingStatus='confirmed'` → 409
    (`already-scheduled`).
  - POST with 4 options → 400 (Zod).
  - POST unauthenticated → 401.
  - `afterAll`: clean up the seeded quote + cascade.
- `bookingRespond.api.test.ts`:
  - Seed: same as above + a proposed round with 3 options.
  - `confirm` valid `optionId` → `quote.status='scheduled'`,
    `bookingStatus='confirmed'`, `option.chosen=true` on the right row
    and `false` on others, `scheduledDate`/`scheduledWindow` mirror the
    chosen option.
  - Repeat `confirm` → 200 with current state, no re-flip
    (idempotency).
  - `confirm` with an `optionId` from a different round → 400.
  - `reject` with valid reason → `bookingStatus='rejected'`,
    `rejectionReason` saved, `Quote.status` stays `approved`.
  - `reject` with reason `< 3 chars` → 400 (Zod refine).
  - After rejection, staff POSTs a new round → round 2 created,
    `bookingStatus` back to `proposed`.
  - `afterAll`: clean up.

### E2E (`tests/e2e/booking.spec.ts`)

Full happy path against a real `next build && next start`:

1. Login as admin (`admin@tiptoptreesltd.com` / `changeme123`).
2. Create a new quote, add one line item, "Save and Send".
3. Open the portal link (captured from the email mock or by reading
   `Quote.publicToken` from the test DB), approve.
4. Back in the staff app: the quote view now shows "Schedule".
5. Click → booking page → fill 2 date+window rows → submit.
6. Re-open the portal link → renders `<BookingPicker>` with 2 cards.
7. Select the first → "Confirm date".
8. Back in staff app: quote view shows "Scheduled: <date> · <window>".

Pacing: the approval and booking flows are server-side and synchronous
from the UI's perspective — no 500ms debounce to wait for, unlike the
draft autosave in `offline-quote.spec.ts`.

## Out of scope (explicitly deferred)

- `Order` / `Job` entity creation on confirmation (sub-project 4).
- Job completion + invoice PDF (sub-project 4).
- Staff push notifications when a client confirms/rejects (would require
  either polling or a websocket — out of scope here; staff refresh
  surfaces the state).
- Resend-booking-email affordance (the round is in the DB; a future UI
  action can call a resend endpoint).
- Per-staff calendar view of all scheduled jobs (sub-project 4 scope).
- Time-zone awareness beyond the server's locale — `proposedDate` is a
  date (no time), and `DayWindow` is a coarse label, so time zones don't
  affect correctness. If a future sub-project moves to exact times,
  this assumption needs revisiting.
