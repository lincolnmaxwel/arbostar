# Stripe Connect Tenant Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Hard prerequisites: `2026-07-18-multi-tenant-foundation.md` AND `2026-07-18-stripe-platform-billing.md` must both be fully merged first** — this plan reuses `Tenant.stripeConnectAccountId`/`stripeConnectChargesEnabled` (added in the foundation plan's schema) and extends the platform webhook route built in the billing plan (Task 7 below modifies `src/app/api/webhooks/stripe/route.ts` directly).

**Goal:** Each tenant connects their *own* Stripe account through Stripe's
hosted Express onboarding (no API-key paste box, no manual entry — a button
that redirects to Stripe, comes back when done). Once connected, their
clients can pay an invoice online; the money lands directly in the tenant's
Stripe account via a destination charge, never passing through the
operator's balance. This is a completely separate Stripe integration from
`2026-07-18-stripe-platform-billing.md` — that plan is the operator charging
tenants; this plan is tenants charging their clients.

**Architecture:** `stripe.accounts.create({ type: 'express' })` +
`stripe.accountLinks.create({ type: 'account_onboarding' })` for onboarding
(operator's API key creates the account object, but the *onboarding form
itself* is entirely hosted by Stripe — the tenant enters their own banking
details on a Stripe-owned page, this app never sees them). A **destination
charge** — a Checkout Session created with the operator's own API key
(not the `stripeAccount` header) carrying
`payment_intent_data.transfer_data.destination: <tenant's connected account
id>` — means the resulting `checkout.session.completed` webhook event fires
on the **platform's** webhook endpoint (the one built in the billing plan),
not a separate one. Only `account.updated` (a genuinely connected-account-
scoped event) needs its own webhook endpoint + secret, mirroring how the
Stripe Dashboard itself separates "events on your account" from "events on
connected accounts" as two distinct endpoint registrations.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma + PostgreSQL,
`stripe` Node SDK (already added in the billing plan), Vitest.

## Global Constraints

- Onboarding (`stripe.accountLinks.create`) links are short-lived (Stripe
  expires them quickly) — never store one; generate a fresh link on every
  "Connect Stripe" click, redirect immediately.
- A tenant's clients can only be charged once `stripeConnectChargesEnabled`
  is `true`. Until then, the public invoice-pay page must degrade
  gracefully (show the invoice, no "Pay now" button, a note to contact the
  company directly) — never a crash or a dead Stripe error page. This
  mirrors the invoice-PDF-generation failure handling already in
  `complete/route.ts` (log it, don't 5xx the request).
- The new public invoice-pay route (`/pay/[token]`) must **not** fall under
  `src/middleware.ts`'s existing matcher (`/quotes/:path*`, `/profile/:path*`,
  `/clients/:path*`, `/invoices/:path*`) — using a top-level `/pay/` path
  (not nested under `/invoices/`) avoids that collision entirely without
  needing to edit the matcher, mirroring how `/portal/[token]` already sits
  outside it.
- Every Stripe call here is reproduced from the design doc's source table
  (verified against current Stripe docs) or the billing plan's already-
  installed `src/lib/stripe.ts` client. No invented parameter names.

---

### Task 1: Connect onboarding route

**Files:**
- Create: `src/app/api/connect/onboard/route.ts`
- Test: `tests/integration/connect-onboard-api.test.ts`

**Interfaces:**
- Produces: `POST /api/connect/onboard` (session-protected, `role: 'admin'`)
  → `{ url }` pointing at Stripe's hosted onboarding, or 401/403.
- Consumes: `requireTenantSession()`, `stripe.accounts.create` (only if
  `Tenant.stripeConnectAccountId` is null), `stripe.accountLinks.create`
  (always, fresh each call).

- [ ] **Step 1: Write the failing test** (same fixture/mock shape as the
  billing plan's `billing-checkout-api.test.ts` — mock `@/lib/stripe`'s
  `stripe.accounts.create` and `stripe.accountLinks.create`, assert: first
  call creates an Express account and persists
  `Tenant.stripeConnectAccountId`; a second call with an existing
  `stripeConnectAccountId` skips `accounts.create` and only creates a fresh
  `accountLinks`).

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/connect-onboard-api.test.ts
```

- [ ] **Step 3: Create `src/app/api/connect/onboard/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTenantSession } from '@/lib/auth';
import { stripe } from '@/lib/stripe';

export async function POST(_req: NextRequest) {
  const session = await requireTenantSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: session.user.tenantId } });

  let accountId = tenant.stripeConnectAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { tenantId: tenant.id },
    });
    accountId = account.id;
    await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeConnectAccountId: accountId } });
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${process.env.NEXTAUTH_URL}/billing?connect=refresh`,
    return_url: `${process.env.NEXTAUTH_URL}/billing?connect=return`,
  });

  return NextResponse.json({ url: accountLink.url });
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/connect-onboard-api.test.ts
git add src/app/api/connect/onboard/route.ts tests/integration/connect-onboard-api.test.ts
git commit -m "feat(connect): Stripe Express onboarding route for tenant payment collection"
```

---

### Task 2: Connect status route

**Files:**
- Create: `src/app/api/connect/status/route.ts`
- Test: `tests/integration/connect-status-api.test.ts`

**Interfaces:**
- Produces: `GET /api/connect/status` → `{ connected: boolean,
  chargesEnabled: boolean, onboardedAt: string | null }`.

- [ ] **Step 1: Write the failing test, then implement**

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTenantSession } from '@/lib/auth';

export async function GET() {
  const session = await requireTenantSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: session.user.tenantId } });
  return NextResponse.json({
    connected: !!tenant.stripeConnectAccountId,
    chargesEnabled: tenant.stripeConnectChargesEnabled,
    onboardedAt: tenant.stripeConnectOnboardedAt?.toISOString() ?? null,
  });
}
```

- [ ] **Step 2: Run and commit**

```bash
npx vitest run tests/integration/connect-status-api.test.ts
git add src/app/api/connect/status/route.ts tests/integration/connect-status-api.test.ts
git commit -m "feat(connect): status endpoint for tenant's Stripe Connect onboarding state"
```

---

### Task 3: Connect webhook — `account.updated`

**Files:**
- Create: `src/app/api/webhooks/stripe-connect/route.ts`
- Test: `tests/integration/stripe-connect-webhook-api.test.ts`

**Interfaces:**
- Produces: `POST /api/webhooks/stripe-connect`, unauthenticated (Stripe is
  the caller; `STRIPE_CONNECT_WEBHOOK_SECRET` verifies it — a **different**
  secret from `STRIPE_WEBHOOK_SECRET`, because this is registered in the
  Stripe Dashboard as a separate "events on connected accounts" endpoint).
  Handles `account.updated`, syncing `stripeConnectChargesEnabled` and
  stamping `stripeConnectOnboardedAt` the first time `charges_enabled`
  flips true.

- [ ] **Step 1: Write the failing test** (same signature-mock pattern as the
  billing plan's `stripe-webhook-api.test.ts` — an `account.updated` event
  with `{ id: 'acct_x', charges_enabled: true, details_submitted: true }`
  should flip `stripeConnectChargesEnabled` to `true` and set
  `stripeConnectOnboardedAt` to a non-null timestamp on the tenant matching
  `stripeConnectAccountId: 'acct_x'`; a second `account.updated` with
  `charges_enabled: false` — e.g. a later compliance hold — should flip it
  back to `false` without clearing the original `stripeConnectOnboardedAt`
  timestamp, since "was onboarded once" and "currently able to charge" are
  different facts).

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/stripe-connect-webhook-api.test.ts
```

- [ ] **Step 3: Create `src/app/api/webhooks/stripe-connect/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature!, process.env.STRIPE_CONNECT_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[stripe connect webhook] signature verification failed', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    if (event.type === 'account.updated') {
      const account = event.data.object as { id: string; charges_enabled: boolean };
      const tenant = await prisma.tenant.findFirst({ where: { stripeConnectAccountId: account.id } });
      if (tenant) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            stripeConnectChargesEnabled: account.charges_enabled,
            ...(account.charges_enabled && !tenant.stripeConnectOnboardedAt
              ? { stripeConnectOnboardedAt: new Date() }
              : {}),
          },
        });
      }
    }
  } catch (err) {
    console.error('[stripe connect webhook] handler error', err);
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/stripe-connect-webhook-api.test.ts
git add src/app/api/webhooks/stripe-connect/route.ts tests/integration/stripe-connect-webhook-api.test.ts
git commit -m "feat(connect): account.updated webhook syncs chargesEnabled/onboardedAt"
```

- [ ] **Step 5: Register in the Stripe Dashboard (manual)**

Developers → Webhooks → add endpoint, check "Listen to events on connected
accounts," URL `<deployed-url>/api/webhooks/stripe-connect`, subscribe to
`account.updated`, copy the secret into `STRIPE_CONNECT_WEBHOOK_SECRET`.
Add both new env vars to `.env.example`:

```
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
```

---

### Task 4: `/billing` page — "Collect payments from your clients" section

**Files:**
- Modify: `src/app/billing/page.tsx` (from the billing plan's Task 6)

**Interfaces:**
- Adds a second section to the existing billing page (do not create a new
  route — this keeps all payments-related admin settings in one place):
  fetches `GET /api/connect/status` alongside the existing
  `GET /api/billing/status` fetch; if `!connected`, shows a "Connect Stripe"
  button posting to `/api/connect/onboard` and redirecting
  `window.location.href = url`; if `connected && !chargesEnabled`, shows
  "Onboarding incomplete — finish setup" with the same button (re-running
  onboarding resumes an incomplete Express account rather than creating a
  duplicate, since `stripe.accounts.create` is skipped once
  `stripeConnectAccountId` exists); if `chargesEnabled`, shows a green
  "Connected — clients can pay their invoices online" confirmation with the
  onboarded date.

- [ ] **Step 1: Extend the page component and its fetch logic per above.**

- [ ] **Step 2: Manual verification** — no new automated test needed here
  (the underlying endpoints already have coverage from Tasks 1–2); run
  `npm run dev`, visit `/billing`, click "Connect Stripe," confirm redirect
  to a real Stripe-hosted onboarding URL in test mode.

- [ ] **Step 3: Commit**

```bash
git add src/app/billing/page.tsx
git commit -m "feat(connect): billing page shows Stripe Connect onboarding status and entry point"
```

---

### Task 5: `Invoice.publicToken` — give invoices a public, payable link

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/app/api/quotes/[id]/complete/route.ts` (already creates the
  `Invoice` row — no new field value needed beyond the schema default)
- Modify: `src/lib/email.ts` (`sendInvoiceEmail` — add the pay link)

**Interfaces:**
- `Invoice.publicToken String @unique @default(uuid())` — same pattern as
  the existing `Quote.publicToken`. No manual assignment needed anywhere;
  Prisma's `@default(uuid())` generates it on `create`, exactly like the
  existing quote token already works.

- [ ] **Step 1: Add the field**

```prisma
model Invoice {
  id          String               @id @default(uuid())
  tenantId    String
  tenant      Tenant               @relation(fields: [tenantId], references: [id])
  number      Int                  @unique @default(autoincrement())
  quoteId     String               @unique
  quote       Quote                @relation(fields: [quoteId], references: [id])
  publicToken String               @unique @default(uuid())
  subtotal    Decimal              @db.Decimal(10, 2)
  taxRate     Decimal              @db.Decimal(5, 4)
  taxAmount   Decimal              @db.Decimal(10, 2)
  total       Decimal              @db.Decimal(10, 2)
  sentAt      DateTime?
  paymentStatus InvoicePaymentStatus @default(pending)
  paidAt      DateTime?
  createdAt   DateTime             @default(now())
}
```

- [ ] **Step 2: Migrate**

```bash
npx prisma migrate dev --name invoice_public_token
```

This is a plain additive nullable-then-defaulted column on a normal
`@default(uuid())` field — Prisma handles the backfill for existing rows
automatically when the new column has a `@default`, unlike the foundation
plan's `tenantId` columns which needed hand-written backfill SQL (those had
no single valid default value per row). Confirm the generated migration
does add a `DEFAULT gen_random_uuid()` (or equivalent) rather than requiring
manual intervention — if it doesn't, stop and hand-edit as in the foundation
plan's Task 1 rather than applying a migration that would fail against
existing `Invoice` rows.

- [ ] **Step 3: Extend `sendInvoiceEmail` in `src/lib/email.ts`**

Add a `payUrl` parameter (`${process.env.NEXTAUTH_URL}/pay/${invoice.publicToken}`,
built by the caller in `complete/route.ts` the same way `portalUrl` is
already built there for quote approval emails) and render it as a "Pay
invoice online" button in the email HTML, alongside the existing PDF
attachment — the PDF stays as the definitive record; the link is the
convenience path when the tenant has Connect set up. Follow the existing
`escapeHtml`/button-styling conventions already used by
`sendQuoteApprovalEmail` in the same file.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/email.ts src/app/api/quotes/[id]/complete/route.ts
git commit -m "feat(invoices): add publicToken, include pay-online link in invoice email"
```

---

### Task 6: Public invoice-pay page + checkout route

**Files:**
- Create: `src/app/pay/[token]/page.tsx`
- Create: `src/app/api/pay/[token]/checkout/route.ts`
- Test: `tests/integration/pay-checkout-api.test.ts`

**Interfaces:**
- `GET /pay/[token]` (Server Component, unauthenticated, mirrors
  `src/app/portal/[token]/page.tsx`'s no-session pattern) — looks up
  `Invoice` by `publicToken` including `quote.tenant` and
  `quote.tenant.companyProfile`, 404 if not found. Renders invoice summary
  (reuse the existing `/invoices/[id]` display logic/component where
  possible rather than duplicating markup). Shows a "Pay now" button only
  when `paymentStatus === 'pending'` AND
  `quote.tenant.stripeConnectChargesEnabled` is true; otherwise shows
  "Paid" (if already paid) or "Online payment isn't set up yet — please
  contact us" (if the tenant hasn't finished Connect onboarding) — **never**
  a broken button.
- `POST /api/pay/[token]/checkout` (public, token-authenticated — same
  trust model as `/api/portal/[token]/respond`) → `{ url }` or 400/404/409
  (`already-paid`, `payments-not-enabled`).

- [ ] **Step 1: Write the failing test for the checkout route**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('@/lib/stripe', () => ({
  stripe: { checkout: { sessions: { create: vi.fn() } } },
}));

import { stripe } from '@/lib/stripe';
import { POST } from '@/app/api/pay/[token]/checkout/route';
import { prisma } from '@/lib/db';

describe('POST /api/pay/[token]/checkout', () => {
  let tenantId: string;
  let invoiceId: string;
  let publicToken: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Pay Co', slug: `pay-${randomUUID()}`, stripeConnectAccountId: 'acct_payco', stripeConnectChargesEnabled: true },
    });
    tenantId = tenant.id;
    const client = await prisma.client.create({ data: { tenantId, name: 'Client', email: `payclient-${randomUUID()}@example.com` } });
    const user = await prisma.user.create({ data: { tenantId, name: 'Staff', email: `paystaff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' } });
    const quote = await prisma.quote.create({
      data: { tenantId, draftId: randomUUID(), clientId: client.id, createdById: user.id, status: 'completed', total: 500 },
    });
    const invoice = await prisma.invoice.create({
      data: { tenantId, quoteId: quote.id, subtotal: 500, taxRate: 0, taxAmount: 0, total: 500 },
    });
    invoiceId = invoice.id;
    publicToken = invoice.publicToken;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { tenantId } });
    await prisma.quote.deleteMany({ where: { tenantId } });
    await prisma.client.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it('creates a destination-charge checkout session routed to the tenant\'s connected account', async () => {
    (stripe.checkout.sessions.create as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_pay_1' });

    const res = await POST(
      new Request(`http://localhost/api/pay/${publicToken}/checkout`, { method: 'POST' }) as any,
      { params: { token: publicToken } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe.com/pay/cs_pay_1');

    const args = (stripe.checkout.sessions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.mode).toBe('payment');
    expect(args.payment_intent_data.transfer_data.destination).toBe('acct_payco');
    expect(args.metadata.invoiceId).toBe(invoiceId);
    expect(args.line_items[0].price_data.unit_amount).toBe(50000); // $500.00 in cents
  });

  it('returns 409 payments-not-enabled when the tenant has not finished Connect onboarding', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeConnectChargesEnabled: false } });
    const res = await POST(
      new Request(`http://localhost/api/pay/${publicToken}/checkout`, { method: 'POST' }) as any,
      { params: { token: publicToken } },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('payments-not-enabled');
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeConnectChargesEnabled: true } });
  });

  it('returns 409 already-paid when the invoice is already marked paid', async () => {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { paymentStatus: 'paid', paidAt: new Date() } });
    const res = await POST(
      new Request(`http://localhost/api/pay/${publicToken}/checkout`, { method: 'POST' }) as any,
      { params: { token: publicToken } },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already-paid');
  });

  it('returns 404 for an unknown token', async () => {
    const res = await POST(
      new Request('http://localhost/api/pay/does-not-exist/checkout', { method: 'POST' }) as any,
      { params: { token: 'does-not-exist' } },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/pay-checkout-api.test.ts
```

- [ ] **Step 3: Create `src/app/api/pay/[token]/checkout/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { stripe } from '@/lib/stripe';

// No auth check by design — publicToken is the credential, same trust
// model as /api/portal/[token]/respond.
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const invoice = await prisma.invoice.findUnique({
    where: { publicToken: params.token },
    include: { quote: { include: { tenant: true } } },
  });
  if (!invoice) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (invoice.paymentStatus === 'paid') {
    return NextResponse.json({ error: 'already-paid' }, { status: 409 });
  }
  if (!invoice.quote.tenant.stripeConnectChargesEnabled || !invoice.quote.tenant.stripeConnectAccountId) {
    return NextResponse.json({ error: 'payments-not-enabled' }, { status: 409 });
  }

  const amountInCents = Math.round(Number(invoice.total) * 100);

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice #${invoice.number}` },
          unit_amount: amountInCents,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      transfer_data: { destination: invoice.quote.tenant.stripeConnectAccountId },
      // Platform fee left at 0 — a pricing decision for the operator to make
      // later (see the design doc's "explicitly out of scope" note), not an
      // architecture question. Change this single value when that decision
      // is made; no other code changes needed.
      application_fee_amount: 0,
    },
    metadata: { invoiceId: invoice.id },
    success_url: `${process.env.NEXTAUTH_URL}/pay/${params.token}?paid=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/pay/${params.token}`,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/pay-checkout-api.test.ts
git add src/app/api/pay tests/integration/pay-checkout-api.test.ts
git commit -m "feat(connect): public invoice checkout — destination charge routed to tenant's connected account"
```

- [ ] **Step 5: Create `src/app/pay/[token]/page.tsx`**

Server Component, no session, mirrors `src/app/portal/[token]/page.tsx`'s
structure: `prisma.invoice.findUnique({ where: { publicToken: params.token
}, include: { quote: { include: { client: true, tenant: { include: {
companyProfile: true } } } } } })`, 404 via `notFound()` if missing. Render
the same invoice summary markup `src/app/invoices/[id]/page.tsx` already
uses for the total/line-items table (extract a shared presentational
component, e.g. `src/components/InvoiceSummary.tsx`, if the two pages'
markup would otherwise duplicate more than a few lines — check that file
first before deciding whether extraction is warranted). Client button
component `src/components/PayInvoiceButton.tsx` (`'use client'`) POSTs to
`/api/pay/[token]/checkout` and redirects `window.location.href = url` on
success, or shows the specific error banner for `already-paid` /
`payments-not-enabled`.

- [ ] **Step 6: Commit**

```bash
git add src/app/pay src/components/PayInvoiceButton.tsx
git commit -m "feat(connect): public /pay/[token] page for client-facing invoice payment"
```

---

### Task 7: Extend the platform webhook to mark invoices paid

**Files:**
- Modify: `src/app/api/webhooks/stripe/route.ts` (built in the billing plan)
- Test: extend `tests/integration/stripe-webhook-api.test.ts`

**Interfaces:**
- The existing `checkout.session.completed` case only handled
  `event.data.object.subscription` (platform billing). Destination-charge
  Checkout Sessions from Task 6 have `mode: 'payment'` and no
  `subscription` field, but do carry the `metadata.invoiceId` set in Task 6
  — branch on `event.data.object.mode` to route each `checkout.session.completed`
  event to the right handler.

- [ ] **Step 1: Extend the test** — add a case posting a
  `checkout.session.completed` event with `{ mode: 'payment', metadata: {
  invoiceId: '<seeded invoice id>' } }` and asserting the `Invoice` row's
  `paymentStatus` flips to `'paid'` and `paidAt` is set.

- [ ] **Step 2: Update the `checkout.session.completed` case**

```ts
case 'checkout.session.completed': {
  const obj = event.data.object as { mode: string; customer?: string; subscription?: string; metadata?: { invoiceId?: string } };
  if (obj.mode === 'subscription') {
    await prisma.tenant.updateMany({
      where: { stripeCustomerId: obj.customer },
      data: { stripeSubscriptionId: obj.subscription, subscriptionStatus: 'active' },
    });
  } else if (obj.mode === 'payment' && obj.metadata?.invoiceId) {
    await prisma.invoice.updateMany({
      where: { id: obj.metadata.invoiceId, paymentStatus: 'pending' },
      data: { paymentStatus: 'paid', paidAt: new Date() },
    });
  }
  break;
}
```

`updateMany` with `paymentStatus: 'pending'` in the `where` (not a plain
`update` by id) makes this idempotent the same way the existing portal
respond routes are — a Stripe webhook retry (Stripe retries non-2xx and
occasionally redelivers even successful ones) hitting this twice does not
throw or double-process; the second call's `updateMany` simply matches zero
rows.

- [ ] **Step 3: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/stripe-webhook-api.test.ts
git add src/app/api/webhooks/stripe/route.ts tests/integration/stripe-webhook-api.test.ts
git commit -m "feat(connect): platform webhook marks invoice paid on destination-charge checkout completion"
```

---

## Final verification checklist

- [ ] `npm test` — full suite green.
- [ ] `npm run build` succeeds.
- [ ] Manual, Stripe test mode: from `/billing`, click "Connect Stripe,"
  complete Express onboarding with Stripe's test data (test SSN, test bank
  account — Stripe's Connect testing docs provide these), confirm
  `chargesEnabled` flips true after the `account.updated` webhook fires
  (use a second `stripe listen` process, or the Stripe CLI's `--events
  account.updated` filter, forwarding to
  `localhost:3000/api/webhooks/stripe-connect` with its own
  `--forward-to` target distinct from the billing plan's listener).
- [ ] Manual: complete a job (`POST /api/quotes/[id]/complete`) for that
  tenant, confirm the invoice email contains a working `/pay/<token>` link,
  complete test-mode checkout (`4242 4242 4242 4242`), confirm the invoice
  flips to `paid` and — in the Stripe Dashboard, viewing the connected
  account (Dashboard → Connect → accounts → the test account) — confirm the
  charge appears on the **connected account's** balance, not the platform's.
- [ ] Confirm the graceful-degrade path: a tenant who never finished Connect
  onboarding still gets their invoice emailed (PDF attached, as today) with
  the `/pay/<token>` link present but the page shows "contact us" instead of
  a broken payment button.
