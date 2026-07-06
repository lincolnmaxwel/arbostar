# Booking / Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a client approves an estimate, let staff propose up to 3 date+window options per round through a dedicated booking page; the client gets an email pointing back to the same public portal link, which now renders a date picker; the client either confirms one option (quote becomes `scheduled`) or rejects all with a reason; staff can re-propose after a rejection.

**Architecture:** All booking state lives in Postgres via Prisma — no Dexie/outbox (booking happens post-approval, when staff are online). Two new tables (`ScheduleRound`, `ScheduleOption`) hang off `Quote`; three new fields on `Quote` (`bookingStatus`, `scheduledDate`, `scheduledWindow`); one new `QuoteStatus` value (`scheduled`); three new enums. Staff booking UI lives in a new route `/quotes/[draftId]/booking` under the existing `/quotes/:path*` session-protecting middleware. Client booking UI is rendered conditionally inside the existing `/portal/[token]` page — same link, no new public routes. One new email function `sendBookingProposalEmail` reuses the existing SMTP transporter and the unchanged `publicToken` portal URL.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma + PostgreSQL, NextAuth (credentials), nodemailer, Vitest (unit/integration, real Postgres), Playwright (E2E against `next build && next start`).

## Global Constraints

- All booking mutations go through server routes; no Dexie/outbox, no client-side persistence.
- `publicToken` (UUID) is the only portal credential — portal booking routes have NO session check, mirroring the existing `respond/route.ts`.
- Staff routes (`/api/quotes/:path*` and `/quotes/:path*`) require `getServerSession(authOptions)`; 401 if absent.
- `bookingStatus` only transitions while `Quote.status === 'approved'` (loop body) or on the terminal `proposed → confirmed` flip to `scheduled`. Never moves backward from `confirmed`/`scheduled`.
- At most one `ScheduleRound` with `status = 'proposed'` per quote at a time. Creating a new round requires `bookingStatus in {idle, rejected}`.
- `scheduledDate`/`scheduledWindow` written only on `proposed → confirmed`, mirror the chosen `ScheduleOption`.
- Portal respond endpoint is idempotent: a repeat click after a decision returns current state without re-flipping (mirrors existing `respond/route.ts`).
- Money fields stay Prisma `Decimal`; convert with `Number(x)` for JSON responses. (Not directly relevant to booking but preserved for any GET that returns the quote.)
- `proposedDate` is `@db.Date` — stored as a JS `Date` at midnight UTC; the API accepts `'YYYY-MM-DD'` strings and stores `new Date(dateString)`.
- Integration tests mock `next-auth`'s `getServerSession` via `vi.mock('next-auth', ...)` and mock `@/lib/email`; they hit a real Postgres through Prisma and clean up created rows in `afterAll`.
- Component tests stub `fetch`/`clipboard`/`createObjectURL` directly (jsdom doesn't implement these) — see `tests/unit/QuoteView.test.tsx` for the pattern.
- E2E runs against `next build && next start` on port 3000; kill anything on 3000 first if results look stale.

---

### Task 1: Prisma schema — booking tables, enums, and Quote fields

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma models `ScheduleRound`, `ScheduleOption`; enums `BookingStatus`, `DayWindow`, `ScheduleRoundStatus`; new `QuoteStatus.scheduled`; new `Quote` fields `bookingStatus`, `scheduledDate`, `scheduledWindow`, `rounds` relation. Downstream tasks rely on the Prisma client generating these.

- [ ] **Step 1: Edit `prisma/schema.prisma` — add `scheduled` to `QuoteStatus`, add three new enums, add fields to `Quote`, add two new models**

Replace the `QuoteStatus` enum block with:

```prisma
enum QuoteStatus {
  draft
  sent
  approved
  declined
  expired
  scheduled
}

enum BookingStatus {
  idle
  proposed
  rejected
  confirmed
}

enum DayWindow {
  morning
  afternoon
  fullday
}

enum ScheduleRoundStatus {
  proposed
  rejected
  confirmed
}
```

In the `Quote` model, add these fields (after `publicToken` is fine, before `items`):

```prisma
  bookingStatus    BookingStatus @default(idle)
  scheduledDate    DateTime?
  scheduledWindow  DayWindow?
  rounds           ScheduleRound[]
```

Add the two new models at the end of the file (after `AuditLog`):

```prisma
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

- [ ] **Step 2: Create the migration and regenerate the Prisma client**

Run:

```bash
npm run db:migrate -- --name booking_scheduling
```

Expected: a new migration file under `prisma/migrations/<timestamp>_booking_scheduling/` is created and applied; `prisma generate` runs automatically as part of `db:migrate` (the `package.json` script is `prisma migrate dev`).

If `db:generate` did not run automatically, run it explicitly:

```bash
npm run db:generate
```

- [ ] **Step 3: Verify the schema landed with a one-off Prisma query**

Run:

```bash
npx tsx -e "import { prisma } from '@/lib/db'; prisma.quote.aggregate({ _count: true }).then(() => prisma.\$disconnect()).then(() => console.log('schema ok'))"
```

If `tsx` is not available, run via a temp script — create `scripts/check-schema.mjs`:

```js
import { prisma } from './src/lib/db.ts';
await prisma.quote.aggregate({ _count: true });
await prisma.$disconnect();
console.log('schema ok');
```

Then `node --experimental-strip scripts/check-schema.mjs` (or just trust Step 2's success output if the inline command is awkward on Windows). The point is: a no-op Prisma call against the new schema must not throw.

Expected output: `schema ok` (no SQL errors about missing columns/tables).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): booking/scheduling schema — ScheduleRound, ScheduleOption, Quote.bookingStatus"
```

---

### Task 2: Email function — `sendBookingProposalEmail`

**Files:**
- Modify: `src/lib/email.ts`
- Test: `tests/unit/email.test.ts` (extend with new describe block)

**Interfaces:**
- Produces: `sendBookingProposalEmail(opts: SendBookingProposalEmailOptions): Promise<void>` where `SendBookingProposalEmailOptions = { to, clientName, portalUrl, roundNumber, options: { date: string; window: 'morning'|'afternoon'|'fullday' }[] }`. Task 3 calls this with the round's options.
- Consumes: existing `getTransporter()`, `escapeHtml()` in the same file.

- [ ] **Step 1: Write the failing test — extend `tests/unit/email.test.ts`**

Append a new `describe` block at the end of the file (after the existing `describe('sendQuoteApprovalEmail', ...)` block). Also add the import for `sendBookingProposalEmail` next to the existing `sendQuoteApprovalEmail` import at the top.

Replace the top import line:

```ts
import { sendQuoteApprovalEmail } from '@/lib/email';
```

with:

```ts
import { sendQuoteApprovalEmail, sendBookingProposalEmail } from '@/lib/email';
```

Append at the end of the file:

```ts
describe('sendBookingProposalEmail', () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
    process.env.SMTP_FROM = 'Arbostar Quotes <test@example.com>';
  });

  it('sends an email with the client name, portal link, round number, and date options', async () => {
    await sendBookingProposalEmail({
      to: 'maria@example.com',
      clientName: 'Maria Silva',
      portalUrl: 'http://localhost:3000/portal/token-xyz',
      roundNumber: 1,
      options: [
        { date: '2026-07-15', window: 'morning' },
        { date: '2026-07-17', window: 'fullday' },
      ],
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('maria@example.com');
    expect(call.from).toBe('Arbostar Quotes <test@example.com>');
    expect(call.subject).toBe('Scheduling options for your approved estimate');
    expect(call.text).toContain('Maria Silva');
    expect(call.text).toContain('http://localhost:3000/portal/token-xyz');
    expect(call.text).toContain('Round 1');
    // Date formatting: 'Tuesday, July 15, 2026' (en-US locale default for toLocaleDateString)
    expect(call.text).toMatch(/July 15, 2026/);
    expect(call.text).toMatch(/July 17, 2026/);
    expect(call.text).toContain('Morning');
    expect(call.text).toContain('Full day');
    expect(call.html).toContain('http://localhost:3000/portal/token-xyz');
    expect(call.html).toContain('Morning');
    expect(call.html).toContain('Full day');
  });

  it('escapes HTML in client name and does not repeat the line-item breakdown', async () => {
    await sendBookingProposalEmail({
      to: 'x@example.com',
      clientName: '<b>Maria</b>',
      portalUrl: 'http://localhost:3000/portal/t',
      roundNumber: 2,
      options: [{ date: '2026-07-15', window: 'afternoon' }],
    });

    const call = sendMailMock.mock.calls[0][0];
    expect(call.html).not.toContain('<b>Maria</b>');
    expect(call.html).toContain('&lt;b&gt;Maria&lt;/b&gt;');
    // No price table — booking email never lists line items.
    expect(call.html).not.toMatch(/\$\d+\.\d{2}/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/email.test.ts
```

Expected: FAIL — `sendBookingProposalEmail is not a function` (or `is not exported from '@/lib/email'`).

- [ ] **Step 3: Implement `sendBookingProposalEmail` in `src/lib/email.ts`**

Append to `src/lib/email.ts` (after the existing `sendQuoteApprovalEmail` function):

```ts
export interface SendBookingProposalEmailOptions {
  to: string;
  clientName: string;
  portalUrl: string;
  roundNumber: number;
  options: { date: string; window: 'morning' | 'afternoon' | 'fullday' }[];
}

const WINDOW_LABEL: Record<'morning' | 'afternoon' | 'fullday', string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function formatOptionDate(dateStr: string): string {
  // dateStr is 'YYYY-MM-DD'; parse at noon local to avoid midnight-UTC edge cases
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function buildOptionsText(options: SendBookingProposalEmailOptions['options']): string {
  return options.map((o) => `- ${formatOptionDate(o.date)} — ${WINDOW_LABEL[o.window]}`).join('\n');
}

function buildOptionsHtml(options: SendBookingProposalEmailOptions['options']): string {
  return options
    .map(
      (o) => `
        <tr>
          <td style="padding:12px;border:1px solid #d1d5db;border-radius:6px;text-align:center;font-weight:600;color:#2c5f2d;">
            ${escapeHtml(formatOptionDate(o.date))}
            <div style="font-weight:400;color:#6b7280;font-size:13px;margin-top:4px;">${escapeHtml(WINDOW_LABEL[o.window])}</div>
          </td>
        </tr>`,
    )
    .join('');
}

export async function sendBookingProposalEmail(opts: SendBookingProposalEmailOptions): Promise<void> {
  const text = `Hi ${opts.clientName},

Your approved estimate is ready to schedule. Round ${opts.roundNumber} of date proposals:

${buildOptionsText(opts.options)}

Pick the one that works for you here: ${opts.portalUrl}
`;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;max-width:600px;margin:0 auto;">
      <p>Hi ${escapeHtml(opts.clientName)},</p>
      <p>Your approved estimate is ready to schedule. Here are ${opts.options.length === 1 ? 'the date option we have' : 'the date options we have'} for you (round ${opts.roundNumber}):</p>
      <table style="width:100%;border-collapse:separate;border-spacing:0 8px;margin:16px 0;">
        <tbody>${buildOptionsHtml(opts.options)}</tbody>
      </table>
      <p style="margin-top:24px;">
        <a href="${opts.portalUrl}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Choose your date
        </a>
      </p>
    </div>
  `;

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: opts.to,
    subject: 'Scheduling options for your approved estimate',
    text,
    html,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`[email] booking proposal preview: ${previewUrl}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/unit/email.test.ts
```

Expected: PASS — all 4 tests (2 existing + 2 new) green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts tests/unit/email.test.ts
git commit -m "feat(email): sendBookingProposalEmail for scheduling rounds"
```

---

### Task 3: Staff booking API — `POST /api/quotes/[id]/booking/round` and `GET /api/quotes/[id]/booking`

**Files:**
- Create: `src/app/api/quotes/[id]/booking/route.ts` (GET booking state)
- Create: `src/app/api/quotes/[id]/booking/round/route.ts` (POST new round)
- Test: `tests/integration/booking-round-api.test.ts`

**Interfaces:**
- Consumes: `getServerSession`, `authOptions`, `prisma`, `sendBookingProposalEmail` (from Task 2), `Quote` with fields from Task 1.
- Produces:
  - `GET /api/quotes/[id]/booking` → `{ quote: { id, status, bookingStatus, scheduledDate, scheduledWindow }, latestRound: { id, roundNumber, status, rejectionReason, proposedAt, respondedAt, options: [{ id, proposedDate, window, chosen }] } | null }` (200, or 404 if quote missing, or 401 if no session).
  - `POST /api/quotes/[id]/booking/round` with body `{ options: [{ date: 'YYYY-MM-DD', window }, ...] }` (1–3 items) → `{ roundId }` (201), or 400/401/404/409.
- Task 5 (booking page) calls GET to render state and POST to submit a new round. Task 6 (QuoteView area) calls GET to render the booking-status badge.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/booking-round-api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendQuoteApprovalEmail: vi.fn().mockResolvedValue(undefined),
  sendBookingProposalEmail: vi.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { sendBookingProposalEmail } from '@/lib/email';
import { GET as getBooking, POST as createRound } from '@/app/api/quotes/[id]/booking/round/route';
import { GET as getBookingState } from '@/app/api/quotes/[id]/booking/route';
import { prisma } from '@/lib/db';

describe('Staff booking API', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Booking Staff', email: `booking-staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });

    const client = await prisma.client.create({
      data: { name: 'Booking Client', email: `booking-client-${randomUUID()}@example.com` },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeEach(() => {
    (sendBookingProposalEmail as ReturnType<typeof vi.fn>).mockClear();
  });

  async function createApprovedQuote(bookingStatus: 'idle' | 'rejected' = 'idle') {
    const draftId = randomUUID();
    return prisma.quote.create({
      data: {
        draftId,
        clientId,
        createdById: userId,
        status: 'approved',
        bookingStatus,
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
  }

  function postRound(quoteId: string, options: Array<{ date: string; window: string }>) {
    return createRound(
      new Request(`http://localhost/api/quotes/${quoteId}/booking/round`, {
        method: 'POST',
        body: JSON.stringify({ options }),
      }) as any,
      { params: { id: quoteId } },
    );
  }

  it('POST: creates a round + options, flips bookingStatus to proposed, sends email', async () => {
    const quote = await createApprovedQuote('idle');

    const res = await postRound(quote.id, [
      { date: '2099-07-15', window: 'morning' },
      { date: '2099-07-17', window: 'fullday' },
    ]);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.roundId).toBeTruthy();

    const round = await prisma.scheduleRound.findUniqueOrThrow({
      where: { id: body.roundId },
      include: { options: true },
    });
    expect(round.roundNumber).toBe(1);
    expect(round.status).toBe('proposed');
    expect(round.options).toHaveLength(2);
    expect(round.options.map((o) => o.window).sort()).toEqual(['fullday', 'morning']);

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.bookingStatus).toBe('proposed');

    expect(sendBookingProposalEmail).toHaveBeenCalledTimes(1);
    const call = (sendBookingProposalEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.to).toContain('booking-client-');
    expect(call.roundNumber).toBe(1);
    expect(call.options).toHaveLength(2);
  });

  it('POST: 409 when a round is already proposed (idempotency on double-submit)', async () => {
    const quote = await createApprovedQuote('idle');
    await postRound(quote.id, [{ date: '2099-08-01', window: 'morning' }]);

    const res = await postRound(quote.id, [{ date: '2099-08-05', window: 'afternoon' }]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('round-already-active');

    const rounds = await prisma.scheduleRound.findMany({ where: { quoteId: quote.id } });
    expect(rounds).toHaveLength(1);
  });

  it('POST: 409 when booking is already confirmed', async () => {
    const quote = await createApprovedQuote('idle');
    await prisma.quote.update({ where: { id: quote.id }, data: { bookingStatus: 'confirmed', status: 'scheduled' } });

    const res = await postRound(quote.id, [{ date: '2099-09-01', window: 'morning' }]);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already-scheduled');
  });

  it('POST: creates round N+1 after a rejection, with correct roundNumber', async () => {
    const quote = await createApprovedQuote('rejected');
    // Seed an existing rejected round 1
    await prisma.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: 1,
        status: 'rejected',
        rejectionReason: 'No good days',
        respondedAt: new Date(),
        options: { create: [{ proposedDate: new Date('2099-06-01'), window: 'morning' }] },
      },
    });

    const res = await postRound(quote.id, [{ date: '2099-07-20', window: 'afternoon' }]);
    expect(res.status).toBe(201);
    const body = await res.json();

    const round = await prisma.scheduleRound.findUniqueOrThrow({
      where: { id: body.roundId },
    });
    expect(round.roundNumber).toBe(2);
    expect(round.status).toBe('proposed');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.bookingStatus).toBe('proposed');
  });

  it('POST: 400 on malformed body (4 options, or bad window, or bad date)', async () => {
    const quote = await createApprovedQuote('idle');

    const tooMany = await postRound(quote.id, [
      { date: '2099-07-15', window: 'morning' },
      { date: '2099-07-16', window: 'morning' },
      { date: '2099-07-17', window: 'morning' },
      { date: '2099-07-18', window: 'morning' },
    ]);
    expect(tooMany.status).toBe(400);

    const badWindow = await postRound(quote.id, [{ date: '2099-07-15', window: 'evening' }]);
    expect(badWindow.status).toBe(400);

    const badDate = await postRound(quote.id, [{ date: 'not-a-date', window: 'morning' }]);
    expect(badDate.status).toBe(400);
  });

  it('POST: 404 for unknown quote id', async () => {
    const res = await postRound('00000000-0000-0000-0000-000000000000', [{ date: '2099-07-15', window: 'morning' }]);
    expect(res.status).toBe(404);
  });

  it('GET: returns booking state with latest round + options', async () => {
    const quote = await createApprovedQuote('idle');
    await postRound(quote.id, [{ date: '2099-07-15', window: 'morning' }]);

    const res = await getBookingState(
      new Request(`http://localhost/api/quotes/${quote.id}/booking`) as any,
      { params: { id: quote.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quote.id).toBe(quote.id);
    expect(body.quote.bookingStatus).toBe('proposed');
    expect(body.latestRound.roundNumber).toBe(1);
    expect(body.latestRound.status).toBe('proposed');
    expect(body.latestRound.options).toHaveLength(1);
  });

  it('GET: returns latestRound null when no rounds exist', async () => {
    const quote = await createApprovedQuote('idle');
    const res = await getBookingState(
      new Request(`http://localhost/api/quotes/${quote.id}/booking`) as any,
      { params: { id: quote.id } },
    );
    const body = await res.json();
    expect(body.latestRound).toBeNull();
    expect(body.quote.bookingStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/integration/booking-round-api.test.ts
```

Expected: FAIL — module `@/app/api/quotes/[id]/booking/round/route` not found, and `@/app/api/quotes/[id]/booking/route` not found.

- [ ] **Step 3: Create `src/app/api/quotes/[id]/booking/route.ts` (GET)**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      bookingStatus: true,
      scheduledDate: true,
      scheduledWindow: true,
    },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const latestRound = await prisma.scheduleRound.findFirst({
    where: { quoteId: params.id },
    orderBy: { roundNumber: 'desc' },
    include: { options: { orderBy: { proposedDate: 'asc' } } },
  });

  return NextResponse.json({
    quote: {
      ...quote,
      scheduledDate: quote.scheduledDate ? quote.scheduledDate.toISOString() : null,
    },
    latestRound: latestRound
      ? {
          id: latestRound.id,
          roundNumber: latestRound.roundNumber,
          status: latestRound.status,
          rejectionReason: latestRound.rejectionReason,
          proposedAt: latestRound.proposedAt.toISOString(),
          respondedAt: latestRound.respondedAt ? latestRound.respondedAt.toISOString() : null,
          options: latestRound.options.map((o) => ({
            id: o.id,
            proposedDate: o.proposedDate.toISOString().slice(0, 10),
            window: o.window,
            chosen: o.chosen,
          })),
        }
      : null,
  });
}
```

- [ ] **Step 4: Create `src/app/api/quotes/[id]/booking/round/route.ts` (POST)**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendBookingProposalEmail } from '@/lib/email';

const roundSchema = z.object({
  options: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        window: z.enum(['morning', 'afternoon', 'fullday']),
      }),
    )
    .min(1)
    .max(3),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = roundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: { client: true },
  });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (quote.status !== 'approved') {
    return NextResponse.json({ error: quote.status === 'scheduled' ? 'already-scheduled' : 'not-approved' }, { status: 409 });
  }
  if (quote.bookingStatus === 'proposed') {
    return NextResponse.json({ error: 'round-already-active' }, { status: 409 });
  }
  if (quote.bookingStatus === 'confirmed') {
    return NextResponse.json({ error: 'already-scheduled' }, { status: 409 });
  }

  // bookingStatus is now 'idle' or 'rejected' — both permit a new round.
  const lastRound = await prisma.scheduleRound.aggregate({
    where: { quoteId: quote.id },
    _max: { roundNumber: true },
  });
  const nextRoundNumber = (lastRound._max.roundNumber ?? 0) + 1;

  const round = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: nextRoundNumber,
        status: 'proposed',
        options: {
          create: parsed.data.options.map((o) => ({
            proposedDate: new Date(o.date + 'T12:00:00.000Z'),
            window: o.window,
          })),
        },
      },
      include: { options: true },
    });
    await tx.quote.update({
      where: { id: quote.id },
      data: { bookingStatus: 'proposed' },
    });
    return created;
  });

  const portalUrl = `${process.env.NEXTAUTH_URL}/portal/${quote.publicToken}`;
  try {
    await sendBookingProposalEmail({
      to: quote.client.email,
      clientName: quote.client.name,
      portalUrl,
      roundNumber: nextRoundNumber,
      options: parsed.data.options,
    });
  } catch (err) {
    // Round is already persisted; email failure is logged but not surfaced to
    // staff as a 5xx — the client can still be pointed at the portal link
    // manually. A future sub-project can add a resend affordance.
    console.error('[booking] sendBookingProposalEmail failed', err);
  }

  return NextResponse.json({ roundId: round.id }, { status: 201 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/integration/booking-round-api.test.ts
```

Expected: PASS — all 7 tests green.

- [ ] **Step 6: Run the full integration suite to confirm no regressions**

Run:

```bash
npm test
```

Expected: all green (existing `quotes-api.test.ts`, `portal-respond-api.test.ts`, etc. still pass — the schema migration added nullable/defaulted fields so existing rows and existing tests are unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/quotes/[id]/booking/route.ts src/app/api/quotes/[id]/booking/round/route.ts tests/integration/booking-round-api.test.ts
git commit -m "feat(api): staff booking endpoints — GET state + POST round"
```

---

### Task 4: Portal booking API — `POST /api/portal/[token]/booking/respond`

**Files:**
- Create: `src/app/api/portal/[token]/booking/respond/route.ts`
- Test: `tests/integration/booking-respond-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `Quote.publicToken`, `ScheduleRound`/`ScheduleOption` from Task 1.
- Produces: `POST /api/portal/[token]/booking/respond` with body `{ decision: 'confirm', optionId }` OR `{ decision: 'reject', reason }` → `{ status, bookingStatus }` (200), or 400/404. Idempotent: repeat click after decision returns current state, does not re-flip.
- Task 7 (`BookingPicker`) calls this endpoint.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/booking-respond-api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { POST } from '@/app/api/portal/[token]/booking/respond/route';
import { prisma } from '@/lib/db';

describe('POST /api/portal/[token]/booking/respond', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Portal Booking Test', email: `pb-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const client = await prisma.client.create({
      data: { name: 'Portal Client', email: `pc-${randomUUID()}@example.com` },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function createProposedQuote() {
    const draftId = randomUUID();
    const quote = await prisma.quote.create({
      data: {
        draftId,
        clientId,
        createdById: userId,
        status: 'approved',
        bookingStatus: 'proposed',
        items: { create: [{ localItemId: randomUUID(), title: 'Tree removal', price: 500, sortOrder: 0 }] },
      },
    });
    const round = await prisma.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: 1,
        status: 'proposed',
        options: {
          create: [
            { proposedDate: new Date('2099-07-15T12:00:00.000Z'), window: 'morning' },
            { proposedDate: new Date('2099-07-17T12:00:00.000Z'), window: 'fullday' },
          ],
        },
      },
      include: { options: true },
    });
    return { quote, round, options: round.options };
  }

  function respond(token: string, body: unknown) {
    return POST(
      new Request(`http://localhost/api/portal/${token}/booking/respond`, {
        method: 'POST',
        body: JSON.stringify(body),
      }) as any,
      { params: { token } },
    );
  }

  it('confirms an option: flips bookingStatus=confirmed, Quote.status=scheduled, marks option chosen, mirrors scheduledDate/Window', async () => {
    const { quote, options } = await createProposedQuote();
    const chosen = options[0];

    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: chosen.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('scheduled');
    expect(body.bookingStatus).toBe('confirmed');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.status).toBe('scheduled');
    expect(updated.bookingStatus).toBe('confirmed');
    expect(updated.scheduledDate?.toISOString().slice(0, 10)).toBe('2099-07-15');
    expect(updated.scheduledWindow).toBe('morning');

    const round = await prisma.scheduleRound.findUniqueOrThrow({
      where: { id: chosen.roundId },
      include: { options: true },
    });
    expect(round.status).toBe('confirmed');
    expect(round.respondedAt).not.toBeNull();
    const chosenOpt = round.options.find((o) => o.id === chosen.id);
    const otherOpt = round.options.find((o) => o.id !== chosen.id);
    expect(chosenOpt?.chosen).toBe(true);
    expect(otherOpt?.chosen).toBe(false);
  });

  it('is idempotent on confirm: second confirm does not re-flip or error', async () => {
    const { quote, options } = await createProposedQuote();
    await respond(quote.publicToken, { decision: 'confirm', optionId: options[0].id });
    const firstRespondedAt = (await prisma.scheduleRound.findFirstOrThrow({ where: { quoteId: quote.id } })).respondedAt;

    // Second confirm with the OTHER option id — must not re-flip to that option.
    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: options[1].id });
    expect(res.status).toBe(200);
    expect((await res.json()).bookingStatus).toBe('confirmed');

    const round = await prisma.scheduleRound.findFirstOrThrow({
      where: { quoteId: quote.id },
      include: { options: true },
    });
    expect(round.respondedAt?.getTime()).toBe(firstRespondedAt?.getTime());
    expect(round.options.find((o) => o.id === options[0].id)?.chosen).toBe(true);
    expect(round.options.find((o) => o.id === options[1].id)?.chosen).toBe(false);
  });

  it('rejects all options with a reason: bookingStatus=rejected, reason saved, Quote.status stays approved', async () => {
    const { quote, round } = await createProposedQuote();

    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'None of those days work for me.' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(body.bookingStatus).toBe('rejected');

    const updated = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updated.status).toBe('approved');
    expect(updated.bookingStatus).toBe('rejected');

    const updatedRound = await prisma.scheduleRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(updatedRound.status).toBe('rejected');
    expect(updatedRound.rejectionReason).toBe('None of those days work for me.');
    expect(updatedRound.respondedAt).not.toBeNull();
  });

  it('is idempotent on reject: second reject does not overwrite the first reason', async () => {
    const { quote, round } = await createProposedQuote();
    await respond(quote.publicToken, { decision: 'reject', reason: 'First reason.' });
    const firstReason = (await prisma.scheduleRound.findUniqueOrThrow({ where: { id: round.id } })).rejectionReason;

    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'Second reason.' });
    expect(res.status).toBe(200);

    const after = await prisma.scheduleRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.rejectionReason).toBe(firstReason);
  });

  it('returns 400 when rejecting without a reason (Zod refine)', async () => {
    const { quote } = await createProposedQuote();
    const res = await respond(quote.publicToken, { decision: 'reject' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when rejecting with a reason shorter than 3 chars', async () => {
    const { quote } = await createProposedQuote();
    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'no' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when optionId does not belong to the active round', async () => {
    const { quote } = await createProposedQuote();
    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await respond('does-not-exist', { decision: 'confirm', optionId: 'x' });
    expect(res.status).toBe(404);
  });

  it('returns current state idempotently when quote is not in proposed state (e.g. already scheduled)', async () => {
    const { quote } = await createProposedQuote();
    await prisma.quote.update({ where: { id: quote.id }, data: { bookingStatus: 'confirmed', status: 'scheduled' } });

    const res = await respond(quote.publicToken, { decision: 'reject', reason: 'should not flip' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bookingStatus).toBe('confirmed');
    expect(body.status).toBe('scheduled');
  });

  it('after rejection, staff can create a new round (round 2) — verified via direct Prisma call', async () => {
    const { quote, round } = await createProposedQuote();
    await respond(quote.publicToken, { decision: 'reject', reason: 'Bad days.' });

    // Simulate staff POST by creating the round directly (the staff endpoint is tested in Task 3).
    const newRound = await prisma.scheduleRound.create({
      data: {
        quoteId: quote.id,
        roundNumber: 2,
        status: 'proposed',
        options: { create: [{ proposedDate: new Date('2099-08-01T12:00:00.000Z'), window: 'morning' }] },
      },
    });
    await prisma.quote.update({ where: { id: quote.id }, data: { bookingStatus: 'proposed' } });

    expect(newRound.roundNumber).toBe(2);
    expect(newRound.roundNumber).toBeGreaterThan(round.roundNumber);

    // Now the client can confirm an option on round 2.
    const r2 = await prisma.scheduleRound.findUniqueOrThrow({ where: { id: newRound.id }, include: { options: true } });
    const res = await respond(quote.publicToken, { decision: 'confirm', optionId: r2.options[0].id });
    expect(res.status).toBe(200);
    expect((await res.json()).bookingStatus).toBe('confirmed');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/integration/booking-respond-api.test.ts
```

Expected: FAIL — module `@/app/api/portal/[token]/booking/respond/route` not found.

- [ ] **Step 3: Create `src/app/api/portal/[token]/booking/respond/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const respondSchema = z
  .object({
    decision: z.enum(['confirm', 'reject']),
    optionId: z.string().uuid().optional(),
    reason: z.string().optional(),
  })
  .refine((d) => d.decision === 'confirm' || (d.reason ?? '').length >= 3, {
    message: 'reason must be at least 3 characters when rejecting',
    path: ['reason'],
  })
  .refine((d) => d.decision === 'reject' || (d.optionId ?? '').length > 0, {
    message: 'optionId is required when confirming',
    path: ['optionId'],
  });

// No auth check by design — the long random publicToken IS the credential,
// exactly like the sibling /api/portal/[token]/respond route for approve/decline.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const quote = await prisma.quote.findUnique({ where: { publicToken: params.token } });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Idempotency: if the quote has already moved past 'proposed' on the booking
  // loop, return current state without re-flipping. Mirrors /respond/route.ts.
  if (quote.status !== 'approved' || quote.bookingStatus !== 'proposed') {
    return NextResponse.json({ status: quote.status, bookingStatus: quote.bookingStatus });
  }

  const activeRound = await prisma.scheduleRound.findFirst({
    where: { quoteId: quote.id, status: 'proposed' },
    orderBy: { roundNumber: 'desc' },
    include: { options: true },
  });
  if (!activeRound) {
    // Defensive — should be unreachable if bookingStatus='proposed' is consistent
    // with a round existing. Surface a 409 so a bug here doesn't silently pass.
    return NextResponse.json({ error: 'no-active-round' }, { status: 409 });
  }

  if (parsed.data.decision === 'confirm') {
    const optionId = parsed.data.optionId!;
    const option = activeRound.options.find((o) => o.id === optionId);
    if (!option) {
      return NextResponse.json({ error: 'option-not-in-round' }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.scheduleOption.updateMany({ where: { roundId: activeRound.id }, data: { chosen: false } }),
      prisma.scheduleOption.update({ where: { id: option.id }, data: { chosen: true } }),
      prisma.scheduleRound.update({
        where: { id: activeRound.id },
        data: { status: 'confirmed', respondedAt: new Date() },
      }),
      prisma.quote.update({
        where: { id: quote.id },
        data: {
          bookingStatus: 'confirmed',
          status: 'scheduled',
          scheduledDate: option.proposedDate,
          scheduledWindow: option.window,
        },
      }),
    ]);
    return NextResponse.json({ status: 'scheduled', bookingStatus: 'confirmed' });
  }

  // decision === 'reject'
  const reason = parsed.data.reason!.slice(0, 2000); // bound at 2k chars to prevent abuse
  await prisma.$transaction([
    prisma.scheduleRound.update({
      where: { id: activeRound.id },
      data: { status: 'rejected', rejectionReason: reason, respondedAt: new Date() },
    }),
    prisma.quote.update({
      where: { id: quote.id },
      data: { bookingStatus: 'rejected' },
    }),
  ]);
  return NextResponse.json({ status: 'approved', bookingStatus: 'rejected' });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/integration/booking-respond-api.test.ts
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/portal/[token]/booking/respond/route.ts tests/integration/booking-respond-api.test.ts
git commit -m "feat(api): portal booking respond — confirm option or reject with reason"
```

---

### Task 5: Staff booking UI — `BookingForm` component + `/quotes/[draftId]/booking` page

**Files:**
- Create: `src/components/BookingForm.tsx`
- Create: `src/components/BookingForm.module.css`
- Create: `src/app/quotes/[draftId]/booking/page.tsx`
- Create: `src/app/quotes/[draftId]/booking/booking.module.css`
- Test: `tests/unit/BookingForm.test.tsx`

**Interfaces:**
- Consumes: `GET /api/quotes/[id]/booking` (from Task 3) to read current state; `POST /api/quotes/[id]/booking/round` (from Task 3) to submit. The page receives `draftId` from the URL, but needs the `serverId` (the actual `Quote.id`) to call the API — it reads that from the local Dexie draft via `localDb.drafts.get(draftId)` (same pattern as `QuoteView`), or accepts a `serverId` prop passed by the page wrapper.
- Produces: `/quotes/[draftId]/booking` page renders `<BookingForm serverId={...} draftId={...} />`, which shows the current booking state, the latest rejection reason (if any), and a 1–3 row date+window form that POSTs on submit.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/BookingForm.test.tsx`:

```tsx
// tests/unit/BookingForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BookingForm } from '@/components/BookingForm';

const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: vi.fn() }),
}));

function mockFetchOnce(responses: Array<{ ok?: boolean; status?: number; json?: () => Promise<unknown> }>) {
  const calls = [...responses];
  global.fetch = vi.fn(() => {
    const next = calls.shift() ?? { ok: true, json: async () => ({}) };
    return Promise.resolve(next as any);
  }) as unknown as typeof fetch;
}

describe('BookingForm', () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
  });

  it('renders one empty date+window row by default and an "Add date" button', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByLabelText(/date/i)).toBeInTheDocument());
    expect(screen.getAllByLabelText(/date/i)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /add date/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send to client/i })).toBeDisabled();
  });

  it('caps at 3 rows and disables "Add date" when 3 exist', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: /add date/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add date/i }));
    fireEvent.click(screen.getByRole('button', { name: /add date/i }));

    expect(screen.getAllByLabelText(/date/i)).toHaveLength(3);
    expect(screen.getByRole('button', { name: /add date/i })).toBeDisabled();
  });

  it('shows the latest rejection reason when bookingStatus=rejected', async () => {
    mockFetchOnce([
      {
        ok: true,
        json: async () => ({
          quote: { id: 'q1', status: 'approved', bookingStatus: 'rejected' },
          latestRound: {
            id: 'r1',
            roundNumber: 1,
            status: 'rejected',
            rejectionReason: 'Those days are all bad.',
            proposedAt: '2099-01-01T00:00:00.000Z',
            respondedAt: '2099-01-02T00:00:00.000Z',
            options: [{ id: 'o1', proposedDate: '2099-07-15', window: 'morning', chosen: false }],
          },
        }),
      },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByText(/those days are all bad/i)).toBeInTheDocument());
  });

  it('blocks submit on a past date with a validation error', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    const dateInput = (await screen.findByLabelText(/date/i)) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: 'morning' } });

    await waitFor(() => expect(screen.getByRole('button', { name: /send to client/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));

    await waitFor(() => expect(screen.getByText(/past date/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the GET, not a POST
  });

  it('blocks submit on duplicate {date, window} rows', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: /add date/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add date/i }));

    const dateInputs = screen.getAllByLabelText(/date/i);
    const future = '2099-07-15';
    fireEvent.change(dateInputs[0], { target: { value: future } });
    fireEvent.change(dateInputs[1], { target: { value: future } });
    const windowSelects = screen.getAllByLabelText(/window/i);
    fireEvent.change(windowSelects[0], { target: { value: 'morning' } });
    fireEvent.change(windowSelects[1], { target: { value: 'morning' } });

    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() => expect(screen.getByText(/duplicate/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1); // still only the GET
  });

  it('submits valid options and redirects back to the quote view on success', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
      { ok: true, status: 201, json: async () => ({ roundId: 'r1' }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    const dateInput = await screen.findByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2099-07-15' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: 'morning' } });

    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/quotes/d1'));
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/quotes/q1/booking/round',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('renders a "round already active" banner on 409', async () => {
    mockFetchOnce([
      { ok: true, json: async () => ({ quote: { id: 'q1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) },
      { ok: false, status: 409, json: async () => ({ error: 'round-already-active' }) },
    ]);
    render(<BookingForm serverId="q1" draftId="d1" />);

    const dateInput = await screen.findByLabelText(/date/i);
    fireEvent.change(dateInput, { target: { value: '2099-07-15' } });
    fireEvent.change(screen.getByLabelText(/window/i), { target: { value: 'morning' } });
    fireEvent.click(screen.getByRole('button', { name: /send to client/i }));

    await waitFor(() => expect(screen.getByText(/round already active/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/BookingForm.test.tsx
```

Expected: FAIL — `Cannot find module '@/components/BookingForm'`.

- [ ] **Step 3: Create `src/components/BookingForm.module.css`**

```css
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 520px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 12px;
  align-items: center;
}

.row input,
.row select {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.addRow {
  align-self: flex-start;
  padding: 6px 12px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
}

.addRow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.removeRow {
  padding: 6px 10px;
  background: #fee2e2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  color: #b91c1c;
}

.submit {
  align-self: flex-start;
  padding: 10px 18px;
  background: #2c5f2d;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.banner {
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
}

.errorBanner {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.infoBanner {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}

.rejection {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #92400e;
  padding: 12px 14px;
  border-radius: 4px;
}

.rejectionLabel {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  margin: 0 0 4px 0;
}

.rejectionReason {
  margin: 0;
  color: #111827;
}

.state {
  font-size: 14px;
  color: #6b7280;
  margin: 0 0 8px 0;
}
```

- [ ] **Step 4: Create `src/components/BookingForm.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './BookingForm.module.css';

type DayWindow = 'morning' | 'afternoon' | 'fullday';
type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';

interface BookingOption {
  id: string;
  proposedDate: string;
  window: DayWindow;
  chosen: boolean;
}

interface BookingState {
  quote: {
    id: string;
    status: string;
    bookingStatus: BookingStatus;
    scheduledDate?: string | null;
    scheduledWindow?: DayWindow | null;
  };
  latestRound: {
    id: string;
    roundNumber: number;
    status: string;
    rejectionReason: string | null;
    proposedAt: string;
    respondedAt: string | null;
    options: BookingOption[];
  } | null;
}

interface Row {
  date: string;
  window: DayWindow;
}

const WINDOW_LABELS: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function BookingForm({ serverId, draftId }: { serverId: string; draftId: string }) {
  const router = useRouter();
  const [state, setState] = useState<BookingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([{ date: '', window: 'morning' }]);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quotes/${serverId}/booking`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: BookingState | null) => {
        if (!cancelled && body) setState(body);
        else if (!cancelled) setLoadError('Could not load booking state.');
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load booking state.');
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  function addRow() {
    if (rows.length >= 3) return;
    setRows([...rows, { date: '', window: 'morning' }]);
  }

  function removeRow(index: number) {
    if (rows.length === 1) return;
    setRows(rows.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const filledRows = rows.filter((r) => r.date && r.window);
  const canSubmit = filledRows.length >= 1 && !submitting;

  function validate(): string | null {
    const today = todayStr();
    for (const r of filledRows) {
      if (r.date < today) return 'Past date not allowed.';
    }
    const seen = new Set<string>();
    for (const r of filledRows) {
      const key = `${r.date}|${r.window}`;
      if (seen.has(key)) return 'Duplicate date+window not allowed.';
      seen.add(key);
    }
    return null;
  }

  async function submit() {
    setValidationError(null);
    setSubmitError(null);
    const err = validate();
    if (err) {
      setValidationError(err);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/quotes/${serverId}/booking/round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: filledRows }),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'round-already-active') {
          setSubmitError('A booking round is already awaiting client response.');
        } else if (body.error === 'already-scheduled') {
          setSubmitError('This quote has already been scheduled.');
        } else {
          setSubmitError('Cannot create a new round right now.');
        }
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setSubmitError('Could not submit. Please try again.');
        setSubmitting(false);
        return;
      }
      router.refresh();
      router.push(`/quotes/${draftId}`);
    } catch {
      setSubmitError('Network error — please try again.');
      setSubmitting(false);
    }
  }

  if (loadError) return <p className={styles.banner}>{loadError}</p>;
  if (!state) return <p>Loading…</p>;

  const { quote, latestRound } = state;
  const rejectedRound = latestRound && latestRound.status === 'rejected' ? latestRound : null;

  return (
    <div className={styles.form}>
      <p className={styles.state}>Current status: {quote.bookingStatus}</p>

      {rejectedRound?.rejectionReason && (
        <div className={styles.rejection}>
          <p className={styles.rejectionLabel}>Client rejected round {rejectedRound.roundNumber}</p>
          <p className={styles.rejectionReason}>"{rejectedRound.rejectionReason}"</p>
        </div>
      )}

      {validationError && <div className={`${styles.banner} ${styles.errorBanner}`}>{validationError}</div>}
      {submitError && <div className={`${styles.banner} ${styles.errorBanner}`}>{submitError}</div>}

      {rows.map((row, i) => (
        <div key={i} className={styles.row}>
          <input
            type="date"
            aria-label={`Date ${i + 1}`}
            value={row.date}
            min={todayStr()}
            onChange={(e) => updateRow(i, { date: e.target.value })}
          />
          <select
            aria-label={`Window ${i + 1}`}
            value={row.window}
            onChange={(e) => updateRow(i, { window: e.target.value as DayWindow })}
          >
            <option value="morning">{WINDOW_LABELS.morning}</option>
            <option value="afternoon">{WINDOW_LABELS.afternoon}</option>
            <option value="fullday">{WINDOW_LABELS.fullday}</option>
          </select>
          <button type="button" className={styles.removeRow} onClick={() => removeRow(i)} aria-label={`Remove date ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}

      <button type="button" className={styles.addRow} onClick={addRow} disabled={rows.length >= 3}>
        Add date
      </button>

      <button type="button" className={styles.submit} onClick={submit} disabled={!canSubmit}>
        {submitting ? 'Sending…' : 'Send to client'}
      </button>
    </div>
  );
}
```

Note: the test queries date/window inputs by `/date/i` and `/window/i` against `aria-label`. The labels above (`Date 1`, `Window 1`) match those regexes. The "Add date" and "Send to client" button names also match.

- [ ] **Step 5: Create `src/app/quotes/[draftId]/booking/booking.module.css`**

```css
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px;
}

.title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px 0;
  color: #111827;
}

.sub {
  margin: 0 0 24px 0;
  color: #6b7280;
  font-size: 14px;
}

.loading {
  color: #6b7280;
}
```

- [ ] **Step 6: Create `src/app/quotes/[draftId]/booking/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { BookingForm } from '@/components/BookingForm';
import styles from './booking.module.css';

export default function BookingPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = params.draftId;
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);
  const [serverId, setServerId] = useState<string | null>(null);

  useEffect(() => {
    if (draft?.serverId) setServerId(draft.serverId);
  }, [draft?.serverId]);

  if (!serverId) return <p className={styles.loading}>This quote must be synced before booking.</p>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Schedule this estimate</h1>
      <p className={styles.sub}>Propose up to 3 date options. The client picks one or asks for new dates.</p>
      <BookingForm serverId={serverId} draftId={draftId} />
    </div>
  );
}
```

- [ ] **Step 7: Run the unit test to verify it passes**

Run:

```bash
npx vitest run tests/unit/BookingForm.test.tsx
```

Expected: PASS — all 7 tests green.

- [ ] **Step 8: Commit**

```bash
git add src/components/BookingForm.tsx src/components/BookingForm.module.css src/app/quotes/[draftId]/booking/page.tsx src/app/quotes/[draftId]/booking/booking.module.css tests/unit/BookingForm.test.tsx
git commit -m "feat(ui): staff booking page + BookingForm component"
```

---

### Task 6: `QuoteView` booking-status area

**Files:**
- Modify: `src/components/QuoteView.tsx`
- Modify: `src/components/QuoteView.module.css`
- Test: `tests/unit/QuoteView.test.tsx` (extend with new tests)

**Interfaces:**
- Consumes: `GET /api/quotes/[id]/booking` (Task 3) when `approval.status` is `'approved'` or `'scheduled'`.
- Produces: a `data-testid="booking-area"` block in `QuoteView` showing the right affordance per `bookingStatus`:
  - `idle` → "Schedule" button (navigates to `/quotes/[draftId]/booking`).
  - `proposed` → disabled "Booking pending" + "Awaiting client response".
  - `rejected` → "Re-propose dates" button.
  - `confirmed`/`scheduled` → text "Scheduled: <date> · <window>".

- [ ] **Step 1: Write the failing tests — extend `tests/unit/QuoteView.test.tsx`**

Add these tests inside the existing `describe('QuoteView', ...)` block (after the last `it(...)`):

```ts
  function seedSyncedDraft(draftId: string, serverId: string) {
    return localDb.drafts.put({
      draftId,
      serverId,
      clientName: 'Booking View Client',
      clientEmail: 'bv@example.com',
      taxRate: 0.05,
      status: 'synced',
      updatedAt: Date.now(),
      items: [{ id: 'i1', title: 'Tree removal', price: 500, photoIds: [] }],
    });
  }

  it('renders a "Schedule" button when the quote is approved and bookingStatus=idle', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ quote: { status: 'approved', publicToken: 'ptok' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ quote: { id: 'q-bv1', status: 'approved', bookingStatus: 'idle' }, latestRound: null }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await seedSyncedDraft('bv-1', 'q-bv1');
    render(<QuoteView draftId="bv-1" />);

    await waitFor(() => expect(screen.getByTestId('booking-area')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /schedule/i })).toBeInTheDocument();
  });

  it('renders "Booking pending" (disabled) when bookingStatus=proposed', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ quote: { status: 'approved', publicToken: 'ptok' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quote: { id: 'q-bv2', status: 'approved', bookingStatus: 'proposed' }, latestRound: { id: 'r', roundNumber: 1, status: 'proposed', rejectionReason: null, proposedAt: '2099-01-01T00:00:00Z', respondedAt: null, options: [] } }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await seedSyncedDraft('bv-2', 'q-bv2');
    render(<QuoteView draftId="bv-2" />);

    await waitFor(() => expect(screen.getByText(/booking pending/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /schedule/i })).not.toBeInTheDocument();
  });

  it('renders "Re-propose dates" when bookingStatus=rejected', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ quote: { status: 'approved', publicToken: 'ptok' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quote: { id: 'q-bv3', status: 'approved', bookingStatus: 'rejected' }, latestRound: { id: 'r', roundNumber: 1, status: 'rejected', rejectionReason: 'Bad days.', proposedAt: '2099-01-01T00:00:00Z', respondedAt: '2099-01-02T00:00:00Z', options: [] } }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await seedSyncedDraft('bv-3', 'q-bv3');
    render(<QuoteView draftId="bv-3" />);

    await waitFor(() => expect(screen.getByRole('button', { name: /re-propose dates/i })).toBeInTheDocument());
  });

  it('renders "Scheduled: <date> · <window>" when quote is scheduled', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ quote: { status: 'scheduled', publicToken: 'ptok' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ quote: { id: 'q-bv4', status: 'scheduled', bookingStatus: 'confirmed', scheduledDate: '2099-07-15T00:00:00.000Z', scheduledWindow: 'morning' }, latestRound: null }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await seedSyncedDraft('bv-4', 'q-bv4');
    render(<QuoteView draftId="bv-4" />);

    await waitFor(() => expect(screen.getByTestId('booking-area')).toHaveTextContent(/scheduled/i));
    expect(screen.getByTestId('booking-area')).toHaveTextContent(/morning/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/QuoteView.test.tsx
```

Expected: FAIL — `Unable to find an element by [data-testid="booking-area"]` (the area doesn't exist yet).

- [ ] **Step 3: Modify `src/components/QuoteView.tsx` — extend the approval fetch + add the booking area**

First, extend the `ApprovalStatus` interface and the fetch logic to also pull booking state. Replace the existing `ApprovalStatus` interface and `APPROVAL_LABEL` constant near the top of the file:

Replace this block:

```tsx
interface ApprovalStatus {
  status: 'draft' | 'sent' | 'approved' | 'declined' | 'expired';
  publicToken: string;
}

const APPROVAL_LABEL: Record<ApprovalStatus['status'], string> = {
  draft: 'Draft',
  sent: 'Pending client approval',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
};
```

with:

```tsx
type BookingStatus = 'idle' | 'proposed' | 'rejected' | 'confirmed';
type DayWindow = 'morning' | 'afternoon' | 'fullday';

interface ApprovalStatus {
  status: 'draft' | 'sent' | 'approved' | 'declined' | 'expired' | 'scheduled';
  publicToken: string;
}

interface BookingState {
  bookingStatus: BookingStatus;
  scheduledDate?: string | null;
  scheduledWindow?: DayWindow | null;
}

const APPROVAL_LABEL: Record<ApprovalStatus['status'], string> = {
  draft: 'Draft',
  sent: 'Pending client approval',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  scheduled: 'Scheduled',
};

const WINDOW_LABEL: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};
```

Inside the `QuoteView` component, add a `booking` state next to `approval`:

Replace:

```tsx
  const [approval, setApproval] = useState<ApprovalStatus | null>(null);
  const [copied, setCopied] = useState(false);
```

with:

```tsx
  const [approval, setApproval] = useState<ApprovalStatus | null>(null);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [copied, setCopied] = useState(false);
```

Extend the existing `useEffect` that fetches `/api/quotes/${serverId}` so that, when the returned status is `'approved'` or `'scheduled'`, it also fires `/api/quotes/${serverId}/booking`:

Replace the existing `useEffect` (the one starting `useEffect(() => { if (!serverId) return; let cancelled = false; fetch(\`/api/quotes/${serverId}\`) ...`):

```tsx
  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;
    fetch(`/api/quotes/${serverId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.quote) {
          setApproval({ status: body.quote.status, publicToken: body.quote.publicToken });
          if (body.quote.status === 'approved' || body.quote.status === 'scheduled') {
            fetch(`/api/quotes/${serverId}/booking`)
              .then((res) => (res.ok ? res.json() : null))
              .then((b) => {
                if (!cancelled && b?.quote) {
                  setBooking({
                    bookingStatus: b.quote.bookingStatus,
                    scheduledDate: b.quote.scheduledDate ?? null,
                    scheduledWindow: b.quote.scheduledWindow ?? null,
                  });
                }
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serverId]);
```

Add a `bookingArea` render block inside the component's JSX — insert it right after the `</div>` that closes the `topBar` div (so it appears just under the title bar, above the `party` block). Find the `</div>` that closes `topBar` (the one containing `topBarActions`), and after it add:

```tsx
      {approval && booking && (approval.status === 'approved' || approval.status === 'scheduled') && (
        <div className={styles.bookingArea} data-testid="booking-area">
          {booking.bookingStatus === 'idle' && (
            <Link href={`/quotes/${draftId}/booking`} className={styles.bookingAction}>
              Schedule
            </Link>
          )}
          {booking.bookingStatus === 'proposed' && (
            <span className={styles.bookingPending}>Booking pending — awaiting client response.</span>
          )}
          {booking.bookingStatus === 'rejected' && (
            <Link href={`/quotes/${draftId}/booking`} className={styles.bookingAction}>
              Re-propose dates
            </Link>
          )}
          {booking.bookingStatus === 'confirmed' && booking.scheduledDate && booking.scheduledWindow && (
            <span className={styles.bookingConfirmed}>
              Scheduled: {new Date(booking.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · {WINDOW_LABEL[booking.scheduledWindow]}
            </span>
          )}
        </div>
      )}
```

- [ ] **Step 4: Add the CSS rules to `src/components/QuoteView.module.css`**

Append to `src/components/QuoteView.module.css`:

```css
.bookingArea {
  margin: 16px 0;
  padding: 12px 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  display: flex;
  align-items: center;
}

.bookingAction {
  display: inline-block;
  padding: 8px 16px;
  background: #2c5f2d;
  color: #fff;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
}

.bookingPending {
  color: #92400e;
  font-size: 14px;
}

.bookingConfirmed {
  color: #2c5f2d;
  font-weight: 600;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/QuoteView.test.tsx
```

Expected: PASS — all existing tests plus the 4 new ones green.

- [ ] **Step 6: Commit**

```bash
git add src/components/QuoteView.tsx src/components/QuoteView.module.css tests/unit/QuoteView.test.tsx
git commit -m "feat(ui): QuoteView booking-status area — Schedule / pending / re-propose / scheduled"
```

---

### Task 7: Portal UI — `BookingPicker` component + `PortalPage` conditional render

**Files:**
- Create: `src/components/BookingPicker.tsx`
- Create: `src/components/BookingPicker.module.css`
- Modify: `src/app/portal/[token]/page.tsx`
- Modify: `src/app/portal/[token]/portal.module.css`
- Test: `tests/unit/BookingPicker.test.tsx`

**Interfaces:**
- Consumes: `POST /api/portal/[token]/booking/respond` (Task 4) for confirm/reject. The server-rendered `PortalPage` already does `prisma.quote.findUnique` and now also fetches the active round + options to pass as props.
- Produces: `<BookingPicker token={...} roundId={...} options={...} />` rendered in place of `<PortalActions>` when `quote.status === 'approved'` and `quote.bookingStatus === 'proposed'`. When `confirmed`/`scheduled`, the portal shows a "Job scheduled for <date> · <window>" banner.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/BookingPicker.test.tsx`:

```tsx
// tests/unit/BookingPicker.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BookingPicker } from '@/components/BookingPicker';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const options = [
  { id: 'o1', proposedDate: '2099-07-15', window: 'morning' as const, chosen: false },
  { id: 'o2', proposedDate: '2099-07-17', window: 'fullday' as const, chosen: false },
];

describe('BookingPicker', () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });

  it('renders one radio card per option', () => {
    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    expect(screen.getByLabelText(/july 15, 2099/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/july 17, 2099/i)).toBeInTheDocument();
    expect(screen.getByText(/morning/i)).toBeInTheDocument();
    expect(screen.getByText(/full day/i)).toBeInTheDocument();
  });

  it('requires selecting an option before Confirm is enabled', () => {
    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    expect(screen.getByRole('button', { name: /confirm date/i })).toBeDisabled();
  });

  it('submits confirm with the selected optionId and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'scheduled', bookingStatus: 'confirmed' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByLabelText(/july 15, 2099/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm date/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/portal/tok/booking/respond', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ decision: 'confirm', optionId: 'o1' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('reveals a required textarea on "Reject all" and blocks submit until ≥3 chars', async () => {
    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: /reject all/i }));

    const textarea = await screen.findByLabelText(/reason/i);
    expect(screen.getByRole('button', { name: /submit reason/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'no' } });
    expect(screen.getByRole('button', { name: /submit reason/i })).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'None of those work.' } });
    expect(screen.getByRole('button', { name: /submit reason/i })).toBeEnabled();
  });

  it('submits reject with the reason and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved', bookingStatus: 'rejected' }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: /reject all/i }));
    const textarea = await screen.findByLabelText(/reason/i);
    fireEvent.change(textarea, { target: { value: 'None of those work.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit reason/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ decision: 'reject', reason: 'None of those work.' });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows an error banner on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<BookingPicker token="tok" roundId="r1" options={options} />);
    fireEvent.click(screen.getByLabelText(/july 15, 2099/i));
    fireEvent.click(screen.getByRole('button', { name: /confirm date/i }));

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/BookingPicker.test.tsx
```

Expected: FAIL — `Cannot find module '@/components/BookingPicker'`.

- [ ] **Step 3: Create `src/components/BookingPicker.module.css`**

```css
.picker {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.optionLabel {
  display: block;
  padding: 12px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.optionLabel:has(input:checked) {
  border-color: #2c5f2d;
  background: #f0fdf4;
}

.optionDate {
  font-weight: 600;
  color: #111827;
}

.optionWindow {
  color: #6b7280;
  font-size: 13px;
  margin-top: 2px;
}

.optionInput {
  margin-right: 10px;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.confirm {
  padding: 10px 18px;
  background: #2c5f2d;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.reject {
  padding: 10px 18px;
  background: #fff;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.rejectBox {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid #fde68a;
  background: #fffbeb;
  border-radius: 6px;
}

.reasonLabel {
  font-size: 13px;
  color: #92400e;
  font-weight: 600;
}

.reasonInput {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  min-height: 60px;
  resize: vertical;
}

.submitReason {
  align-self: flex-start;
  padding: 8px 14px;
  background: #92400e;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.submitReason:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  padding: 8px 12px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  font-size: 14px;
}
```

- [ ] **Step 4: Create `src/components/BookingPicker.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './BookingPicker.module.css';

type DayWindow = 'morning' | 'afternoon' | 'fullday';

export interface BookingPickerOption {
  id: string;
  proposedDate: string;
  window: DayWindow;
  chosen: boolean;
}

const WINDOW_LABELS: Record<DayWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function BookingPicker({
  token,
  roundId,
  options,
}: {
  token: string;
  roundId: string;
  options: BookingPickerOption[];
}) {
  const router = useRouter();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [submiting, setSubmitting] = useState<'confirm' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selectedOptionId) return;
    setSubmitting('confirm');
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/booking/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'confirm', optionId: selectedOptionId }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(null);
    }
  }

  async function reject() {
    setSubmitting('reject');
    setError(null);
    try {
      const res = await fetch(`/api/portal/${token}/booking/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', reason }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(null);
    }
  }

  return (
    <div className={styles.picker}>
      <p>Pick the date that works for you:</p>
      <div className={styles.options} role="radiogroup" aria-label="Date options">
        {options.map((opt) => (
          <label key={opt.id} className={styles.optionLabel}>
            <input
              type="radio"
              name="date-option"
              value={opt.id}
              className={styles.optionInput}
              checked={selectedOptionId === opt.id}
              onChange={() => setSelectedOptionId(opt.id)}
              aria-label={formatDate(opt.proposedDate)}
            />
            <span className={styles.optionDate}>{formatDate(opt.proposedDate)}</span>
            <div className={styles.optionWindow}>{WINDOW_LABELS[opt.window]}</div>
          </label>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {rejecting ? (
        <div className={styles.rejectBox}>
          <label className={styles.reasonLabel} htmlFor="reject-reason">
            Reason
          </label>
          <textarea
            id="reject-reason"
            className={styles.reasonInput}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason"
            placeholder="Tell us why these dates don't work."
          />
          <button
            type="button"
            className={styles.submitReason}
            onClick={reject}
            disabled={reason.trim().length < 3 || submiting !== null}
          >
            {submiting === 'reject' ? 'Submitting…' : 'Submit reason'}
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.confirm}
            onClick={confirm}
            disabled={!selectedOptionId || submiting !== null}
          >
            {submiting === 'confirm' ? 'Submitting…' : 'Confirm date'}
          </button>
          <button
            type="button"
            className={styles.reject}
            onClick={() => setRejecting(true)}
            disabled={submiting !== null}
          >
            Reject all
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run:

```bash
npx vitest run tests/unit/BookingPicker.test.tsx
```

Expected: PASS — all 6 tests green.

- [ ] **Step 6: Modify `src/app/portal/[token]/page.tsx` to fetch the active round and conditionally render `BookingPicker`**

Replace the entire contents of `src/app/portal/[token]/page.tsx` with:

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PortalActions } from '@/components/PortalActions';
import { PortalItemsTable } from '@/components/PortalItemsTable';
import { BookingPicker } from '@/components/BookingPicker';
import styles from './portal.module.css';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  scheduled: 'Scheduled',
};

const WINDOW_LABEL: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  fullday: 'Full day',
};

function formatScheduledDate(iso: Date | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  d.setHours(12, 0, 0, 0);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PortalPage({ params }: { params: { token: string } }) {
  const quote = await prisma.quote.findUnique({
    where: { publicToken: params.token },
    include: {
      client: true,
      items: { orderBy: { sortOrder: 'asc' }, include: { photos: { orderBy: { sortOrder: 'asc' } } } },
    },
  });

  if (!quote) notFound();

  const activeRound =
    quote.status === 'approved' && quote.bookingStatus === 'proposed'
      ? await prisma.scheduleRound.findFirst({
          where: { quoteId: quote.id, status: 'proposed' },
          orderBy: { roundNumber: 'desc' },
          include: { options: { orderBy: { proposedDate: 'asc' } } },
        })
      : null;

  const showBookingPicker = !!(activeRound && activeRound.options.length > 0);
  const showScheduledBanner = quote.status === 'scheduled' || quote.bookingStatus === 'confirmed';
  const scheduledDateStr = formatScheduledDate(quote.scheduledDate);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.topBar}>
          <span className={`${styles.statusBadge} ${styles[quote.status]}`}>{STATUS_LABEL[quote.status]}</span>
          <div>
            <h1 className={styles.title}>Estimate #{quote.number}</h1>
            {quote.sentAt && <p className={styles.meta}>Sent {new Date(quote.sentAt).toLocaleDateString()}</p>}
          </div>
        </div>

        <div className={styles.party}>
          <h2 className={styles.partyLabel}>To</h2>
          <p className={styles.partyName}>{quote.client.name}</p>
          {quote.client.email && <p className={styles.partyLine}>{quote.client.email}</p>}
          {quote.client.phone && <p className={styles.partyLine}>{quote.client.phone}</p>}
          {quote.client.address && <p className={styles.partyLine}>{quote.client.address}</p>}
        </div>

        <PortalItemsTable
          items={quote.items.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            price: Number(item.price),
            photos: item.photos.map((photo) => ({ id: photo.id, filePath: photo.filePath })),
          }))}
        />

        <div className={styles.totals}>
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span>${Number(quote.subtotal).toFixed(2)}</span>
          </div>
          <div className={styles.totalRow}>
            <span>Tax ({(Number(quote.taxRate) * 100).toFixed(1)}%)</span>
            <span>${Number(quote.taxAmount).toFixed(2)}</span>
          </div>
          <div className={`${styles.totalRow} ${styles.grandTotal}`}>
            <span>Total</span>
            <span>${Number(quote.total).toFixed(2)}</span>
          </div>
        </div>

        {quote.status === 'sent' && <PortalActions token={params.token} status={quote.status} />}

        {showBookingPicker && activeRound && (
          <BookingPicker
            token={params.token}
            roundId={activeRound.id}
            options={activeRound.options.map((o) => ({
              id: o.id,
              proposedDate: o.proposedDate.toISOString().slice(0, 10),
              window: o.window,
              chosen: o.chosen,
            }))}
          />
        )}

        {showScheduledBanner && scheduledDateStr && quote.scheduledWindow && (
          <div className={styles.scheduledBanner}>
            Job scheduled for {scheduledDateStr} · {WINDOW_LABEL[quote.scheduledWindow]}
          </div>
        )}

        {quote.status === 'approved' && quote.bookingStatus === 'idle' && (
          <p className={styles.bookingWait}>Staff will propose scheduling dates shortly.</p>
        )}
        {quote.status === 'approved' && quote.bookingStatus === 'rejected' && (
          <p className={styles.bookingWait}>Staff will propose new dates shortly.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the new CSS rules to `src/app/portal/[token]/portal.module.css`**

Append:

```css
.scheduledBanner {
  margin-top: 16px;
  padding: 12px 16px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #2c5f2d;
  border-radius: 6px;
  font-weight: 600;
}

.bookingWait {
  margin-top: 16px;
  color: #6b7280;
  font-style: italic;
}
```

Also add a `scheduled` class to the status-badge family (the existing CSS file keys status badges by status name like `.sent`, `.approved`). Add:

```css
.scheduled {
  background: #2c5f2d;
  color: #fff;
}
```

(If a `.scheduled` rule already exists from the prior core-quote-builder work, skip this addition — check first.)

- [ ] **Step 8: Run all unit tests to confirm no regressions**

Run:

```bash
npx vitest run tests/unit
```

Expected: PASS — all unit tests green (existing + BookingForm + BookingPicker + QuoteView extended).

- [ ] **Step 9: Commit**

```bash
git add src/components/BookingPicker.tsx src/components/BookingPicker.module.css src/app/portal/[token]/page.tsx src/app/portal/[token]/portal.module.css tests/unit/BookingPicker.test.tsx
git commit -m "feat(ui): portal BookingPicker + conditional render in PortalPage"
```

---

### Task 8: E2E — full booking happy path

**Files:**
- Test: `tests/e2e/booking.spec.ts`

**Interfaces:**
- Consumes: every prior task end-to-end against `next build && next start`. Uses the seeded admin user (`admin@tiptoptreesltd.com` / `changeme123`) and `prisma` directly to look up `publicToken` + `draftId` + `Quote.id` after the staff user clicks Save and Send.

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/booking.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';

const CLIENT_EMAIL = `booking.e2e.${process.pid}@example.com`;
const CLIENT_NAME = 'Booking E2E Client';

test('full booking flow: approve → propose dates → client confirms → staff sees scheduled', async ({ page }) => {
  // 1. Login as admin.
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@tiptoptreesltd.com');
  await page.getByLabel('Password').fill('changeme123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/quotes');

  // 2. Create a quote, add one line item, Save and Send.
  await page.goto('/quotes/new');
  await page.waitForURL(/\/quotes\/new\?draft=.+/);
  const draftFromUrl = new URL(page.url()).searchParams.get('draft')!;

  await page.getByLabel('Client name').fill(CLIENT_NAME);
  await page.waitForTimeout(600);
  await page.getByLabel('Client email').fill(CLIENT_EMAIL);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Add service' }).click();
  await page.waitForTimeout(600);
  await page.getByLabel('Service title').fill('Tree removal');
  await page.waitForTimeout(600);
  await page.getByLabel('Price').fill('800');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Save and Send' }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });

  // 3. Look up the quote via the DB to get publicToken + Quote.id.
  const quote = await prisma.quote.findFirstOrThrow({
    where: { client: { email: CLIENT_EMAIL } },
  });
  expect(quote.publicToken).toBeTruthy();

  // 4. Client approves via the portal.
  await page.goto(`/portal/${quote.publicToken}`);
  await expect(page.getByText(/estimate #/i)).toBeVisible();
  await page.getByRole('button', { name: /approve/i }).click();
  await page.waitForURL(`/portal/${quote.publicToken}`);

  // After approval, the portal should show the "Staff will propose scheduling dates shortly" copy
  // (bookingStatus=idle).
  await expect(page.getByText(/staff will propose scheduling dates shortly/i)).toBeVisible();

  // 5. Staff opens the quote view and clicks "Schedule".
  await page.goto(`/quotes/${draftFromUrl}`);
  await expect(page.getByTestId('booking-area')).toBeVisible();
  await page.getByRole('link', { name: /schedule/i }).click();
  await page.waitForURL(/\/quotes\/.*\/booking/);

  // 6. Fill 2 date options and submit.
  const future1 = '2099-07-15';
  const future2 = '2099-07-17';
  const dateInputs = page.getByLabel(/date/i);
  await dateInputs.first().fill(future1);
  await page.getByLabel(/window/i).first().selectOption('morning');
  await page.getByRole('button', { name: /add date/i }).click();
  await dateInputs.nth(1).fill(future2);
  await page.getByLabel(/window/i).nth(1).selectOption('fullday');

  await page.getByRole('button', { name: /send to client/i }).click();
  await page.waitForURL(`/quotes/${draftFromUrl}`);

  // 7. Client opens the portal again — now the BookingPicker should be visible.
  await page.goto(`/portal/${quote.publicToken}`);
  await expect(page.getByRole('radiogroup', { name: /date options/i })).toBeVisible();
  await page.getByLabel(/july 15, 2099/i).check();
  await page.getByRole('button', { name: /confirm date/i }).click();

  // After confirm, the portal should show the "Job scheduled for" banner.
  await expect(page.getByText(/job scheduled for/i)).toBeVisible();
  await expect(page.getByText(/july 15, 2099/i)).toBeVisible();
  await expect(page.getByText(/morning/i)).toBeVisible();

  // 8. Staff quote view now shows the scheduled banner.
  await page.goto(`/quotes/${draftFromUrl}`);
  await expect(page.getByTestId('booking-area')).toHaveText(/scheduled/i);
  await expect(page.getByTestId('booking-area')).toHaveText(/july 15, 2099/i);
});

test.afterAll(async () => {
  // Clean up the E2E-created quote so re-runs don't accumulate.
  const quotes = await prisma.quote.findMany({ where: { client: { email: CLIENT_EMAIL } } });
  for (const q of quotes) {
    await prisma.quote.delete({ where: { id: q.id } });
  }
  await prisma.client.deleteMany({ where: { email: CLIENT_EMAIL } });
  await prisma.$disconnect();
});
```

- [ ] **Step 2: Make sure port 3000 is free (kill any stale `next dev`/`next start`), then run the E2E spec**

```bash
npm run test:e2e -- tests/e2e/booking.spec.ts
```

The `test:e2e` script runs `next build && next start` and Playwright against that. Expected: 1 passed.

If the run is flaky or stale, check whether a leftover server is on port 3000 (the `playwright.config.ts` `reuseExistingServer` flag would silently reuse a stale one — kill it first).

- [ ] **Step 3: Run the FULL test suite once to confirm nothing regressed**

```bash
npm test
npm run test:e2e
```

Expected: all unit + integration + e2e green.

- [ ] **Step 4: Run lint and build as final verification**

```bash
npm run lint
npm run build
```

Expected: no lint errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/booking.spec.ts
git commit -m "test(e2e): full booking happy path — approve → propose → confirm → scheduled"
```

---

## Self-Review

**1. Spec coverage** (spec sections → tasks):

- Data model (Prisma additions) → Task 1. ✓
- State machine (idle → proposed → confirmed/rejected, with iteration) → Task 3 (round POST enforces pre-conditions) + Task 4 (respond POST enforces the proposed→confirmed/rejected transitions + idempotency). ✓
- Staff UI (`QuoteView` booking-status area) → Task 6. ✓
- Staff UI (booking page + form) → Task 5. ✓
- Portal UI (`BookingPicker` + `PortalPage` conditional render) → Task 7. ✓
- Email (`sendBookingProposalEmail`) → Task 2. ✓
- API (POST `/api/quotes/[id]/booking/round`) → Task 3. ✓
- API (POST `/api/portal/[token]/booking/respond`) → Task 4. ✓
- API (GET `/api/quotes/[id]/booking`) → Task 3. ✓
- Testing (unit BookingForm, BookingPicker, QuoteView extended) → Tasks 5, 7, 6. ✓
- Testing (integration bookingRound + bookingRespond) → Tasks 3, 4. ✓
- Testing (E2E happy path) → Task 8. ✓
- Out of scope items (Order entity, push notifications, calendar view, time zones, resend-email affordance) → explicitly NOT in any task; preserved as deferred. ✓

**2. Placeholder scan:** no TBD/TODO/`implement later`/`add appropriate ...`/`similar to Task N` in any step. All code is complete.

**3. Type consistency:**

- `BookingStatus` is `'idle' | 'proposed' | 'rejected' | 'confirmed'` everywhere (Task 1 Prisma enum, Task 3 API, Task 5 BookingForm, Task 6 QuoteView, Task 7 BookingPicker + PortalPage). ✓
- `DayWindow` is `'morning' | 'afternoon' | 'fullday'` everywhere. ✓
- `SendBookingProposalEmailOptions.options` items have `{ date: string; window: 'morning'|'afternoon'|'fullday' }` — matches what Task 3 passes (`parsed.data.options` is already that shape from the Zod schema). ✓
- `GET /api/quotes/[id]/booking` response shape: `{ quote: { id, status, bookingStatus, scheduledDate, scheduledWindow }, latestRound: {...} | null }` — consumed identically by BookingForm (Task 5) and QuoteView (Task 6). ✓
- `BookingPicker` props: `{ token, roundId, options: { id, proposedDate, window, chosen }[] }` — PortalPage (Task 7) maps the Prisma rows to exactly that shape (`proposedDate.toISOString().slice(0, 10)`). ✓
- `POST /api/portal/[token]/booking/respond` body: `{ decision: 'confirm', optionId }` or `{ decision: 'reject', reason }` — matches what BookingPicker (Task 7) sends. ✓
- Test for "Past date" in BookingForm uses `'2020-01-01'` and expects a `/past date/i` validation message — the implementation produces `'Past date not allowed.'` which matches. ✓
- Test for "duplicate" expects `/duplicate/i` — implementation produces `'Duplicate date+window not allowed.'`. ✓
- Test for "round already active" expects `/round already active/i` — implementation sets `'A booking round is already awaiting client response.'`. ✓

No issues found. Plan ready.
