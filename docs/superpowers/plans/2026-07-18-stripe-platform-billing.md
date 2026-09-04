# Stripe Platform Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Hard prerequisite: `2026-07-18-multi-tenant-foundation.md` must be fully merged and its Task 9 (tenant isolation test) green before starting here** — every task below reads/writes `Tenant.subscriptionStatus` and friends, which don't exist until that plan lands.

**Goal:** The Arbostar operator (not each tenant) charges every subscribing
company a recurring platform fee via Stripe Billing, on the operator's own
Stripe account. A tenant can start a 14-day trial with no card, add a
payment method from `/billing` when ready, and self-serve manage/cancel
through Stripe's hosted Billing Portal. Subscription status stays in sync
via webhook, and the app gates the highest-value write actions (sending a
quote, completing a job/invoice) once a subscription lapses — without
locking a lapsed tenant out of viewing their own historical data.

**Architecture:** One new Stripe integration, entirely separate from the
Stripe Connect integration in `2026-07-18-stripe-connect-payouts.md` — this
plan never touches a tenant's own Stripe account, only the operator's.
`stripe.checkout.sessions.create({ mode: 'subscription' })` for signup,
`stripe.billingPortal.sessions.create()` for self-serve management, one
webhook endpoint (`/api/webhooks/stripe`, its own `STRIPE_WEBHOOK_SECRET`)
keeping `Tenant.subscriptionStatus`/`currentPeriodEnd` in sync. All API
surfaces verified against current Stripe docs during the design phase — see
the source table in `docs/superpowers/specs/2026-07-18-multi-tenant-saas-design.md`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma + PostgreSQL,
`stripe` Node SDK (new dependency), NextAuth, Vitest.

## Global Constraints

- This plan's webhook route must read the **raw** request body
  (`await request.text()`) and pass it untouched to
  `stripe.webhooks.constructEvent()` — parsing it as JSON first breaks
  signature verification. Next.js App Router route handlers do not
  auto-parse the body, so no special `bodyParser: false` config is needed
  (that's a Pages Router concern); just don't call `.json()` before
  `constructEvent`.
- Every Stripe API call in this plan is either a documented method
  reproduced from the design doc's source table, or explicitly marked
  "verify against `node_modules/stripe/types` before writing" where the
  design research didn't cover an exact parameter shape.
- Never trust a client-submitted subscription status. The only writer of
  `Tenant.subscriptionStatus`/`stripeSubscriptionId`/`currentPeriodEnd` is
  the webhook handler (Task 3) — the checkout-session route (Task 2) only
  ever reads the `Stripe-Signature`-verified webhook to learn what actually
  happened; it never sets status directly off a client redirect.
- Gating (Task 5) blocks only the specific write actions named in that task
  — it must never block `GET` requests. A canceled tenant keeps read access
  to their own historical data; only new billable actions are blocked. This
  mirrors how Jobber and comparable SaaS tools handle lapses (data isn't
  held hostage, new usage is).

---

### Task 1: Add the `stripe` dependency and env config

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: a shared `getStripeClient()` in `src/lib/stripe.ts`, imported by
  every later task in both this plan and the Connect plan.

- [ ] **Step 1: Install**

```bash
npm install stripe
```

- [ ] **Step 2: Create `src/lib/stripe.ts`**

```ts
import Stripe from 'stripe';

const globalForStripe = global as unknown as { stripe?: Stripe };

export const stripe =
  globalForStripe.stripe ||
  new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-06-20',
  });

if (process.env.NODE_ENV !== 'production') {
  globalForStripe.stripe = stripe;
}
```

(Mirrors the existing `global`-cached singleton pattern already used for
Prisma in `src/lib/db.ts` — avoids reinstantiating the SDK on every dev
hot-reload.) Confirm the pinned `apiVersion` string against whatever
`node_modules/stripe/package.json` actually ships once installed — the SDK
will warn or error at startup if the string doesn't match a real API
version; adjust to match rather than guessing.

- [ ] **Step 3: Add to `.env.example`**

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PLATFORM_PRICE_ID=price_...
```

`STRIPE_PLATFORM_PRICE_ID` is the operator's own recurring Price object,
created once in the Stripe Dashboard (Products → the Arbostar subscription
product → its monthly Price) — not something this plan creates
programmatically, since pricing is a business decision made in the
Dashboard, not in code.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/stripe.ts
git commit -m "chore(stripe): add stripe SDK, shared client, platform billing env vars"
```

---

### Task 2: Checkout — start/attach a subscription

**Files:**
- Create: `src/app/api/billing/checkout/route.ts`
- Test: `tests/integration/billing-checkout-api.test.ts`

**Interfaces:**
- Produces: `POST /api/billing/checkout` (session-protected, `role: 'admin'`
  only — billing is an admin action) → `{ url }` (200) pointing at a Stripe
  Checkout page, or 401/403.
- Consumes: `requireTenantSession()`, `stripe.customers.create` (only if
  `Tenant.stripeCustomerId` is still null), `stripe.checkout.sessions.create`.

- [ ] **Step 1: Write the failing test**

Mock the `stripe` module (do not hit real Stripe in tests — this repo's
existing convention mocks external services like `@/lib/email` the same
way):

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));

import { getServerSession } from 'next-auth';
import { stripe } from '@/lib/stripe';
import { POST } from '@/app/api/billing/checkout/route';
import { prisma } from '@/lib/db';

describe('POST /api/billing/checkout', () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: 'Checkout Co', slug: `checkout-${randomUUID()}` } });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: { tenantId, name: 'Admin', email: `checkout-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId, tenantId, role: 'admin' } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it('creates a Stripe customer when the tenant has none, then a checkout session', async () => {
    (stripe.customers.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cus_new123' });
    (stripe.checkout.sessions.create as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_abc' });

    const res = await POST(new Request('http://localhost/api/billing/checkout', { method: 'POST' }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_abc');

    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    const updated = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(updated.stripeCustomerId).toBe('cus_new123');

    const sessionArgs = (stripe.checkout.sessions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sessionArgs.mode).toBe('subscription');
    expect(sessionArgs.customer).toBe('cus_new123');
    expect(sessionArgs.line_items[0].price).toBe(process.env.STRIPE_PLATFORM_PRICE_ID);
  });

  it('reuses an existing stripeCustomerId without creating a new customer', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: 'cus_existing' } });
    (stripe.customers.create as ReturnType<typeof vi.fn>).mockClear();
    (stripe.checkout.sessions.create as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_def' });

    const res = await POST(new Request('http://localhost/api/billing/checkout', { method: 'POST' }) as any);
    expect(res.status).toBe(200);
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/billing-checkout-api.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/api/billing/checkout/route.ts`**

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

  let stripeCustomerId = tenant.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: tenant.name,
      metadata: { tenantId: tenant.id },
    });
    stripeCustomerId = customer.id;
    await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId } });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: process.env.STRIPE_PLATFORM_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/billing?checkout=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/billing?checkout=cancelled`,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/billing-checkout-api.test.ts
git add src/app/api/billing/checkout/route.ts tests/integration/billing-checkout-api.test.ts
git commit -m "feat(billing): checkout session route — creates/reuses Stripe customer, starts subscription"
```

---

### Task 3: Webhook — sync `Tenant.subscriptionStatus` from Stripe events

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`
- Test: `tests/integration/stripe-webhook-api.test.ts`

**Interfaces:**
- Produces: `POST /api/webhooks/stripe`, unauthenticated (Stripe itself is
  the caller; the `Stripe-Signature` header + `STRIPE_WEBHOOK_SECRET` is the
  credential, same trust model as the existing public portal routes'
  `publicToken`). Handles `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: vi.fn() } },
}));

import { stripe } from '@/lib/stripe';
import { POST } from '@/app/api/webhooks/stripe/route';
import { prisma } from '@/lib/db';

describe('POST /api/webhooks/stripe', () => {
  let tenantId: string;

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: 'Webhook Co', slug: `webhook-${randomUUID()}`, stripeCustomerId: 'cus_wh123' },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  function postEvent(event: unknown) {
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockReturnValue(event);
    return POST(
      new Request('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: 'raw-body-placeholder',
      }) as any,
    );
  }

  it('checkout.session.completed: attaches subscriptionId, sets status active', async () => {
    const res = await postEvent({
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_wh123', subscription: 'sub_new123' } },
    });
    expect(res.status).toBe(200);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.stripeSubscriptionId).toBe('sub_new123');
    expect(tenant.subscriptionStatus).toBe('active');
  });

  it('customer.subscription.updated: syncs status and currentPeriodEnd', async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const res = await postEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_new123', customer: 'cus_wh123', status: 'past_due', current_period_end: periodEnd } },
    });
    expect(res.status).toBe(200);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.subscriptionStatus).toBe('past_due');
    expect(tenant.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
  });

  it('customer.subscription.deleted: sets status canceled', async () => {
    const res = await postEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_new123', customer: 'cus_wh123' } },
    });
    expect(res.status).toBe(200);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.subscriptionStatus).toBe('canceled');
  });

  it('returns 400 when signature verification throws', async () => {
    (stripe.webhooks.constructEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const res = await POST(
      new Request('http://localhost/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'bad' }, body: 'x' }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('unknown customer: does not throw, returns 200 (Stripe retries on non-2xx)', async () => {
    const res = await postEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_x', customer: 'cus_does_not_exist', status: 'active', current_period_end: 0 } },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/stripe-webhook-api.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/api/webhooks/stripe/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const obj = event.data.object as { customer: string; subscription: string };
        await prisma.tenant.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { stripeSubscriptionId: obj.subscription, subscriptionStatus: 'active' },
        });
        break;
      }
      case 'customer.subscription.updated': {
        const obj = event.data.object as { customer: string; status: string; current_period_end: number };
        // Stripe's subscription status strings map 1:1 onto our SubscriptionStatus
        // enum EXCEPT 'unpaid'/'incomplete_expired', which we fold into 'past_due'/
        // 'canceled' respectively — narrower than Stripe's set, matches what the
        // app actually branches on (Task 5's gate).
        const status = mapStripeStatus(obj.status);
        await prisma.tenant.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { subscriptionStatus: status, currentPeriodEnd: new Date(obj.current_period_end * 1000) },
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const obj = event.data.object as { customer: string };
        await prisma.tenant.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { subscriptionStatus: 'canceled' },
        });
        break;
      }
      case 'invoice.payment_failed': {
        const obj = event.data.object as { customer: string };
        await prisma.tenant.updateMany({
          where: { stripeCustomerId: obj.customer },
          data: { subscriptionStatus: 'past_due' },
        });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // A DB error handling a webhook must not make Stripe retry forever with
    // the same transient failure — log it, still 200, matching this repo's
    // existing pattern of never turning a downstream failure into a 5xx that
    // cascades (see the invoice-email try/catch in complete/route.ts).
    console.error('[stripe webhook] handler error', err);
  }

  return NextResponse.json({ received: true });
}

function mapStripeStatus(stripeStatus: string): 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/stripe-webhook-api.test.ts
git add src/app/api/webhooks/stripe/route.ts tests/integration/stripe-webhook-api.test.ts
git commit -m "feat(billing): Stripe webhook — sync Tenant.subscriptionStatus from subscription lifecycle events"
```

- [ ] **Step 5: Register the webhook in the Stripe Dashboard (manual, not code)**

Dashboard → Developers → Webhooks → add endpoint
`<deployed-url>/api/webhooks/stripe`, subscribe to exactly the four event
types handled above, copy the generated signing secret into
`STRIPE_WEBHOOK_SECRET` in the deploy environment. Note in the PR/commit
description that this manual step is required post-deploy — it cannot be
automated from application code.

---

### Task 4: Billing Portal — self-serve manage/cancel

**Files:**
- Create: `src/app/api/billing/portal/route.ts`
- Test: `tests/integration/billing-portal-api.test.ts`

**Interfaces:**
- Produces: `POST /api/billing/portal` (session-protected, `role: 'admin'`)
  → `{ url }` pointing at Stripe's hosted Billing Portal, or 400 if the
  tenant has no `stripeCustomerId` yet (hasn't started checkout).

- [ ] **Step 1: Write the failing test** (same mock/fixture shape as Task 2's
  test — a tenant with `stripeCustomerId` set, mock
  `stripe.billingPortal.sessions.create` to return `{ url }`, assert the
  route passes `customer` and `return_url` through and 400s when
  `stripeCustomerId` is null).

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/billing-portal-api.test.ts
```

- [ ] **Step 3: Create `src/app/api/billing/portal/route.ts`**

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
  if (!tenant.stripeCustomerId) {
    return NextResponse.json({ error: 'no-subscription' }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${process.env.NEXTAUTH_URL}/billing`,
  });

  return NextResponse.json({ url: portalSession.url });
}
```

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
npx vitest run tests/integration/billing-portal-api.test.ts
git add src/app/api/billing/portal/route.ts tests/integration/billing-portal-api.test.ts
git commit -m "feat(billing): Stripe Billing Portal session route for self-serve subscription management"
```

---

### Task 5: `/billing` page + status endpoint + write-action gating

**Files:**
- Create: `src/app/api/billing/status/route.ts`
- Create: `src/app/billing/page.tsx`
- Create: `src/components/SubscriptionBanner.tsx`
- Modify: `src/components/Header.tsx` (mount the banner)
- Modify: `src/app/api/quotes/route.ts` (`POST`, only the `data.send === true`
  branch)
- Modify: `src/app/api/quotes/[id]/complete/route.ts`
- Test: `tests/integration/billing-status-api.test.ts`
- Test: extend `tests/integration/quotes-api.test.ts` and
  `tests/integration/quotes-complete-api.test.ts` with a
  "blocked when tenant is canceled" case

**Interfaces:**
- `GET /api/billing/status` → `{ subscriptionStatus, trialEndsAt,
  currentPeriodEnd, daysLeftInTrial }`.
- New `requireActiveTenantAction()` in `src/lib/auth.ts`, built on top of
  `requireTenantSession()`: returns the session unchanged if
  `subscriptionStatus` is `trialing` (and `trialEndsAt` hasn't passed) or
  `active`/`past_due`; returns `null` if `canceled` or a trial past its
  `trialEndsAt`. Callers that get `null` respond 402 (Payment Required —
  the semantically correct status code for "this specific action needs an
  active subscription," distinct from 401/403).

- [ ] **Step 1: Add `requireActiveTenantAction()` to `src/lib/auth.ts`**

```ts
export async function requireActiveTenantAction() {
  const session = await requireTenantSession();
  if (!session) return null;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: session.user.tenantId } });
  const trialExpired = tenant.subscriptionStatus === 'trialing' && tenant.trialEndsAt !== null && tenant.trialEndsAt < new Date();
  if (tenant.subscriptionStatus === 'canceled' || trialExpired) return null;
  return session;
}
```

- [ ] **Step 2: Write the failing tests** (billing-status-api.test.ts follows
  the same shape as prior tasks' tests; the two extended files add one case
  each: set the fixture tenant's `subscriptionStatus` to `'canceled'`, call
  the route with `send: true` / call complete, assert 402)

- [ ] **Step 3: Run to verify they fail**

```bash
npx vitest run tests/integration/billing-status-api.test.ts tests/integration/quotes-api.test.ts tests/integration/quotes-complete-api.test.ts
```

- [ ] **Step 4: Create `src/app/api/billing/status/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTenantSession } from '@/lib/auth';

export async function GET() {
  const session = await requireTenantSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: session.user.tenantId } });
  const daysLeftInTrial =
    tenant.subscriptionStatus === 'trialing' && tenant.trialEndsAt
      ? Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null;

  return NextResponse.json({
    subscriptionStatus: tenant.subscriptionStatus,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: tenant.currentPeriodEnd?.toISOString() ?? null,
    daysLeftInTrial,
  });
}
```

- [ ] **Step 5: Wire the gate into the two write routes**

In `src/app/api/quotes/route.ts`'s `POST`, only the send path needs gating
(saving a draft without sending should never be blocked — a lapsed tenant
must still be able to keep working locally and catch up once they pay).
Change the top of the handler:

```ts
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = upsertQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const session = data.send ? await requireActiveTenantAction() : await requireTenantSession();
  if (!session) {
    return NextResponse.json(
      { error: data.send ? 'subscription-required' : 'unauthorized' },
      { status: data.send ? 402 : 401 },
    );
  }
  const { tenantId } = session.user;
  // ...rest unchanged...
```

In `src/app/api/quotes/[id]/complete/route.ts`, swap its
`requireTenantSession()` call for `requireActiveTenantAction()` outright —
marking a job complete and generating a client-facing invoice is exactly
the kind of new billable usage that should require an active subscription.

- [ ] **Step 6: Create `src/app/billing/page.tsx`**

Client component (`'use client'`), fetches `GET /api/billing/status` on
mount, renders current status/trial countdown, a "Subscribe" button posting
to `/api/billing/checkout` and redirecting `window.location.href = url`, and
(when `stripeCustomerId` exists — infer from `subscriptionStatus !==
'trialing'` with `trialEndsAt` still null being the "never started
checkout" case) a "Manage billing" button posting to `/api/billing/portal`.
Follow the existing `/profile` page's fetch-on-mount + button-triggers-POST
structure for consistency.

- [ ] **Step 7: Create `src/components/SubscriptionBanner.tsx`**

Client component, fetches `/api/billing/status`, renders nothing when
`subscriptionStatus === 'active'`, otherwise a small dismissible-per-session
banner: "Trial ends in N days" (trialing), "Payment failed — update your
card" linking to `/billing` (past_due), or "Subscription canceled" linking
to `/billing` (canceled). Mount it inside `src/components/Header.tsx`,
which is already a client component per the existing `useSession()`-based
header dropdown described in `CLAUDE.md`.

- [ ] **Step 8: Run full suite, then commit**

```bash
npm test
git add src/lib/auth.ts src/app/api/billing src/app/billing src/components/SubscriptionBanner.tsx src/components/Header.tsx src/app/api/quotes/route.ts src/app/api/quotes/[id]/complete/route.ts tests/integration/billing-status-api.test.ts tests/integration/quotes-api.test.ts tests/integration/quotes-complete-api.test.ts
git commit -m "feat(billing): /billing page, subscription banner, gate quote-send and job-complete on active subscription"
```

---

## Final verification checklist

- [ ] `npm test` — full suite green, including the new 402-on-lapsed-tenant
  cases.
- [ ] `npm run build` succeeds.
- [ ] Manual: with `STRIPE_SECRET_KEY`/`STRIPE_PLATFORM_PRICE_ID` set to
  Stripe **test-mode** keys, run `npm run dev`, sign up a fresh tenant,
  click Subscribe from `/billing`, complete Stripe's test checkout
  (`4242 4242 4242 4242`), confirm redirect back and `subscriptionStatus`
  flips to `active` once the webhook fires (use the Stripe CLI's `stripe
  listen --forward-to localhost:3000/api/webhooks/stripe` for local webhook
  delivery — this is the standard local-dev pattern for Stripe webhooks).
- [ ] Confirm a `canceled` tenant can still load `/quotes`, `/invoices`,
  view individual quotes, but gets a 402 attempting to send a new quote.
