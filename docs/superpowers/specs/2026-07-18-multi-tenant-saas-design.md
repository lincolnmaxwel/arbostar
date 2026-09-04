# Design: Multi-Tenant SaaS + Platform Billing + Per-Tenant Payment Collection

Status: approved
Date: 2026-07-18
Sub-project 5 (pivot). Supersedes the single-tenant assumption stated
throughout `CLAUDE.md` ("one deployment per company, no multi-tenant
isolation, no RBAC").

## Context

Arbostar has shipped as a single-tenant app: one deployment, one Postgres
database, one company. The business model is changing — Arbostar becomes a
subscription SaaS product (à la Jobber: $29–599/mo tiers) sold to many tree
service companies from **one** hosted instance. Two distinct money flows are
needed, and they must not be conflated:

1. **Platform billing** — the Arbostar operator (the user building this)
   charges each subscribing company a recurring fee via Stripe Billing. This
   is the operator's own Stripe account.
2. **Tenant payment collection** — each subscribing company needs to collect
   payment from *their own* clients on invoices Arbostar generates. Each
   company connects its *own* Stripe account (Stripe Connect, Express) so
   money for their tree jobs goes straight to them, never through the
   operator's account.

This is a foundational architecture change, not a feature. It touches auth,
the entire Prisma schema, every API route, and adds two new Stripe
integrations. It is split into three executable plans, in dependency order:

- `2026-07-18-multi-tenant-foundation.md` — Tenant entity, tenant-scoped
  schema, session/auth carrying `tenantId`, every route re-scoped, signup
  flow, existing single-tenant data backfilled into one "grandfathered"
  tenant. **Nothing else can start before this lands** — Stripe Billing and
  Stripe Connect both need a `Tenant` row to hang off of.
- `2026-07-18-stripe-platform-billing.md` — subscription checkout, billing
  portal, webhook-driven subscription status, access gating on lapse.
- `2026-07-18-stripe-connect-payouts.md` — per-tenant Connect Express
  onboarding, and wiring invoice payment collection through each tenant's
  connected account.

## Requirements driving this design

- One Arbostar deployment must serve many companies ("tenants"), each seeing
  only their own clients/quotes/invoices — never another tenant's data.
- The operator (not each tenant) charges a recurring platform subscription
  fee.
- Each tenant must be able to connect their *own* Stripe account, through an
  onboarding flow simple enough for a non-technical tree service owner to
  complete unattended (Stripe's hosted Express onboarding, not a raw
  API-key paste box).
- Money a tenant collects from their client must land in the tenant's own
  Stripe account, not the operator's.
- Existing production data (per `CLAUDE.md`'s testing-conventions warning
  about the live `CompanyProfile` row) must survive the migration —
  everything that exists today becomes tenant #1, not deleted.
- Everything the offline-first draft/outbox/sync pipeline, the client
  approval portal, and invoice/PDF generation already does must keep working
  — this is additive scoping, not a rewrite of those subsystems.

## Architecture

### Tenant is a new top-level entity, `CompanyProfile` stays branding-only

```prisma
enum SubscriptionStatus {
  trialing
  active
  past_due
  canceled
  incomplete
}

model Tenant {
  id                     String              @id @default(uuid())
  name                   String
  slug                   String              @unique
  createdAt              DateTime            @default(now())
  // Platform billing (Stripe Billing — the OPERATOR's Stripe account)
  stripeCustomerId       String?             @unique
  stripeSubscriptionId   String?             @unique
  subscriptionStatus     SubscriptionStatus  @default(trialing)
  trialEndsAt            DateTime?
  currentPeriodEnd       DateTime?
  // Tenant's own payment collection (Stripe Connect Express — the TENANT's account)
  stripeConnectAccountId String?             @unique
  stripeConnectChargesEnabled Boolean        @default(false)
  stripeConnectOnboardedAt    DateTime?

  users          User[]
  clients        Client[]
  quotes         Quote[]
  invoices       Invoice[]
  companyProfile CompanyProfile?
  serviceCatalogItems ServiceCatalogItem[]
  auditLogs      AuditLog[]
}
```

`CompanyProfile` keeps its current shape (name/phone/email/address/logo,
shown as the portal's "From" party) but drops the fixed `id: 'company'`
singleton convention in favor of `tenantId String @unique` — one row per
tenant instead of one row, period. `getCompanyProfile()` becomes
`getCompanyProfile(tenantId)`.

Why two entities instead of folding billing fields into `CompanyProfile`:
`CompanyProfile` is read on every public portal page render (unauthenticated,
by token) to show branding — it should never carry Stripe secrets or
subscription internals in its query shape. `Tenant` is only ever read
server-side, scoped to an authenticated session or a webhook handler.

### Every tenant-owned table gets `tenantId`

Direct `tenantId` column (not just "reachable by joining through Quote") on:
`User`, `Client`, `Quote`, `Invoice`, `ServiceCatalogItem`, `AuditLog`. Not
added to `QuoteItem`, `QuotePhoto`, `ScheduleRound`, `ScheduleOption` — they
are always reached through their parent `Quote`, which is already
tenant-scoped, and adding a duplicate column there would just be one more
place to forget to keep in sync.

**Critical correctness fix, not a stylistic choice:** `Client.email` is
currently `@unique` globally. Two different tenants' clients can legitimately
share an email address (nothing prevents two tree service companies both
having a customer at the same address). Left as-is, `prisma.client.upsert({
where: { email } })` — the exact upsert `POST /api/quotes` already does —
would silently attach Tenant B's quote to Tenant A's `Client` row the moment
both tenants had a client with the same email. This is a cross-tenant data
leak, not a cosmetic bug. It becomes `@@unique([tenantId, email])`.

`User.email` stays globally unique — one login identity per person. Someone
working for two tenant companies needs two accounts with different emails;
acceptable, and it keeps "which tenant do I log into" unambiguous from the
login email alone without a company-picker step.

`Quote.number` / `Invoice.number` (global auto-increment) are left global
in v1 — cosmetic only (a tenant's first quote might show as "#4381"), no
functional bug, no data leak. Revisit only if tenants complain; a
per-tenant sequence needs raw SQL sequences per tenant and isn't worth the
complexity for a cosmetic concern.

`Quote.publicToken` and `Quote.draftId` stay globally unique and
**unscoped** by design — the public portal resolves a quote by token alone,
with no tenant context available (the visitor never logs in). Tenant is
derived transitively from `quote.tenantId` once the row is found, used only
to pick which `CompanyProfile` to render as the "From" party.

### Session carries `tenantId`

NextAuth JWT/session callbacks (`src/lib/auth.ts`) add `token.tenantId` at
login (from `User.tenantId`) and expose `session.user.tenantId`. A
`src/types/next-auth.d.ts` module augmentation extends NextAuth's `Session`/
`User`/`JWT` interfaces (standard documented NextAuth TypeScript pattern —
see `next-auth` docs "TypeScript" page) so `session.user.tenantId` type-checks
everywhere without casting.

A new `requireTenantSession()` helper in `src/lib/auth.ts` replaces the
repeated `getServerSession(authOptions); if (!session?.user) return 401`
boilerplate seen in all 15 existing API routes, and additionally guarantees
`tenantId` is present:

```ts
export async function requireTenantSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) return null;
  return session as TenantSession;
}
```

Every authenticated route's first Prisma query gains `tenantId:
session.user.tenantId` in its `where`. This is the single highest-risk part
of the whole migration — miss it on one route and that route leaks
cross-tenant data. The foundation plan enumerates every one of the 15
existing API route files plus 2 server-component pages that query Prisma
directly, and adds a dedicated **tenant isolation integration test** (two
tenants, two datasets, assert every list/get endpoint returns only the
calling tenant's rows) as its own verification task — not just "trust the
diff."

### Access gating (subscription lapse) does not live in edge middleware

The existing `src/middleware.ts` uses `next-auth/middleware`'s `withAuth`,
which runs on the Edge runtime — Prisma's standard Postgres driver isn't
Edge-compatible, so subscription-status gating can't be a middleware DB
lookup without adopting Prisma Accelerate (out of scope). Instead,
subscription status is checked server-side in the authenticated route group
(a shared `layout.tsx` under the existing protected routes, or a
`requireActiveTenant()` check called from each protected page), redirecting
to `/billing` when `subscriptionStatus` is `past_due` past its grace period
or `canceled`. Full detail in the Stripe Billing plan.

### Signup flow

New public `/signup` page + `POST /api/signup`: company name, admin email,
password → creates `Tenant` (`subscriptionStatus: 'trialing'`, `trialEndsAt:
now + 14d`) and the first `User` (`role: 'admin'`, that `tenantId`) in one
transaction, no payment method required up front (mirrors Jobber's 14-day
free trial — see the earlier Jobber pricing research, `getjobber.com/pricing`).
Card capture happens later, from `/billing`, via Stripe Checkout
(`mode: 'subscription'`) — detailed in the Stripe Billing plan.

### Backfill of existing production data

The live database already has real rows (the exact row the
`CLAUDE.md` testing-conventions section warns not to `deleteMany` in tests).
The migration must not delete or orphan any of it. Two-step schema change,
standard safe-migration pattern:

1. `prisma migrate dev --create-only` to generate the diff without applying
   it, then hand-edit the generated SQL: add every new `tenantId` column as
   **nullable** first, insert one `INSERT INTO "Tenant" ...` seeding a
   single grandfathered tenant (`subscriptionStatus = 'active'`, no trial
   clock — this tenant is not asked to pay retroactively), then
   `UPDATE ... SET "tenantId" = '<seeded-id>'` for every existing row in
   `User`, `Client`, `Quote`, `Invoice`, `ServiceCatalogItem`, `AuditLog`,
   and `CompanyProfile` (moving its PK off the fixed `'company'` id onto the
   seeded tenant id), **then** `ALTER COLUMN "tenantId" SET NOT NULL` and add
   the new `@@unique([tenantId, email])` / drop the old global unique on
   `Client.email`.
2. Apply with `prisma migrate deploy` (not `dev`, so the hand-edited SQL runs
   verbatim instead of Prisma regenerating it from the schema diff).

Full step-by-step with the actual SQL is in the foundation plan's Task 1.

## Stripe integration summary (verified against current Stripe docs, sources cited in each plan)

| Concern | Stripe API surface | Whose Stripe account |
|---|---|---|
| Platform subscription checkout | `stripe.checkout.sessions.create({ mode: 'subscription', ... })` | Operator |
| Self-serve manage/cancel subscription | `stripe.billingPortal.sessions.create({ customer, return_url })` | Operator |
| Subscription lifecycle sync | `stripe.webhooks.constructEvent()` on `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` | Operator |
| Tenant connects their own account | `stripe.accounts.create({ type: 'express' })` + `stripe.accountLinks.create({ type: 'account_onboarding', ... })` | Tenant (Connect) |
| Onboarding completion check | `account.charges_enabled` / `account.details_submitted`, refreshed via `account.updated` webhook | Tenant (Connect) |
| Client pays a tenant's invoice | Checkout Session with `payment_intent_data.transfer_data.destination: <tenant's connected account id>` and optional `application_fee_amount` for a platform cut | Tenant, funds land with tenant |

Two separate Stripe webhook endpoints (this mirrors how the Stripe Dashboard
itself separates "Events on your account" from "Events on connected
accounts" under Connect settings — not one endpoint filtering by type):
`/api/webhooks/stripe` (platform subscription events, `STRIPE_WEBHOOK_SECRET`)
and `/api/webhooks/stripe-connect` (`account.updated` from connected
accounts, `STRIPE_CONNECT_WEBHOOK_SECRET`).

## Explicitly out of scope for this pivot

- Per-tenant custom subdomains (`companyx.arbostar.com`) — login stays on one
  shared host for v1; revisit once there's a branding/marketing reason to
  add it.
- Any RBAC beyond the existing `admin`/`staff` split. The only new
  role-gated surface is the `/billing` and Connect-onboarding settings pages
  (restricted to `role: 'admin'`, consistent with the existing enum) —
  ordinary quote/client/invoice data access remains "every staff user in the
  tenant sees everything," unchanged from today's documented no-RBAC stance,
  just now scoped to one tenant instead of the whole database.
- Platform taking an `application_fee_amount` cut of tenant-collected
  payments is wired but left at `0` by default in the Connect plan — a
  pricing decision for the operator to make later, not an architecture
  question.
