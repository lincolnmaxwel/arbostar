# Multi-Tenant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is the prerequisite for `2026-07-18-stripe-platform-billing.md` and `2026-07-18-stripe-connect-payouts.md` — neither can start until Task 9 (tenant isolation test) passes.

**Goal:** Convert Arbostar from single-tenant (one deployment, one company,
per `CLAUDE.md`) into multi-tenant (one deployment, many companies, each
seeing only their own data), without losing any existing production data and
without breaking the offline-first draft/sync pipeline, the client approval
portal, or invoice/PDF generation. Full context and the reasoning behind
every schema/session decision below is in
`docs/superpowers/specs/2026-07-18-multi-tenant-saas-design.md` — read it
first.

**Architecture:** New `Tenant` model. `tenantId` added directly to `User`,
`Client`, `Quote`, `Invoice`, `ServiceCatalogItem`, `AuditLog`.
`CompanyProfile` moves from a fixed-id singleton to one row per tenant
(`tenantId @unique`). `Client.email`'s uniqueness moves from global to
`@@unique([tenantId, email])` — the one correctness-critical change in this
plan (prevents two tenants' same-email clients from silently merging via the
existing `client.upsert`). NextAuth session carries `tenantId`. A
`requireTenantSession()` helper centralizes the auth+tenant check that every
API route needs. Existing production data is backfilled into one
grandfathered tenant, not deleted.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma + PostgreSQL,
NextAuth (credentials, JWT session), Vitest (integration tests against real
Postgres), zod.

## Global Constraints

- Every existing API route (15 files) and every server component that
  queries Prisma directly (3 files: `src/app/invoices/page.tsx`,
  `src/app/invoices/[id]/page.tsx`, `src/app/portal/[token]/page.tsx`) must
  be updated in this plan — none deferred to the Stripe plans.
- No destructive schema step runs before its data is backfilled. The
  migration SQL is hand-edited (`--create-only`), never a blind `prisma
  migrate dev` on tables with live rows.
- `Quote.publicToken` / `Quote.draftId` lookups (portal pages, portal respond
  routes) stay **unscoped** by `tenantId` — the public visitor has no tenant
  context; tenant is derived only after the row is found, to pick which
  `CompanyProfile` to render.
- Every integration test that currently creates a `User`/`Client`/`Quote`
  without a `tenantId` will fail to compile/insert once `tenantId` is
  `NOT NULL` — Task 10 fixes the existing suite; do not skip it or treat
  broken existing tests as "pre-existing failures unrelated to this work."
- `role: 'admin'` gates only the new `/billing`-adjacent settings surface
  added in the later Stripe plans — this plan does not add any RBAC to
  quotes/clients/invoices.

---

### Task 1: Prisma schema — `Tenant` model, `tenantId` everywhere, backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Modify (hand-edited after `--create-only`): generated file under
  `prisma/migrations/<timestamp>_multi_tenant_foundation/migration.sql`

**Interfaces:**
- Produces: `Tenant` model; `SubscriptionStatus` enum; `tenantId` field +
  relation on `User`, `Client`, `Quote`, `Invoice`, `ServiceCatalogItem`,
  `AuditLog`; `CompanyProfile.tenantId @unique` replacing the fixed `id:
  'company'` convention; `@@unique([tenantId, email])` on `Client` replacing
  the global `email @unique`. Every later task depends on this schema.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add near the top, after the existing enums:

```prisma
enum SubscriptionStatus {
  trialing
  active
  past_due
  canceled
  incomplete
}

model Tenant {
  id                     String             @id @default(uuid())
  name                   String
  slug                   String             @unique
  createdAt              DateTime           @default(now())

  stripeCustomerId       String?            @unique
  stripeSubscriptionId   String?            @unique
  subscriptionStatus     SubscriptionStatus @default(trialing)
  trialEndsAt            DateTime?
  currentPeriodEnd       DateTime?

  stripeConnectAccountId       String?      @unique
  stripeConnectChargesEnabled  Boolean      @default(false)
  stripeConnectOnboardedAt     DateTime?

  users               User[]
  clients             Client[]
  quotes              Quote[]
  invoices            Invoice[]
  companyProfile      CompanyProfile?
  serviceCatalogItems ServiceCatalogItem[]
  auditLogs           AuditLog[]
}
```

Modify `User`:

```prisma
model User {
  id                String   @id @default(uuid())
  tenantId          String
  tenant            Tenant   @relation(fields: [tenantId], references: [id])
  name              String
  email             String   @unique
  passwordHash      String
  role              Role     @default(staff)
  notificationEmail String?
  createdAt         DateTime @default(now())
  quotes            Quote[]

  @@index([tenantId])
}
```

Modify `Client` — note the uniqueness change:

```prisma
model Client {
  id       String  @id @default(uuid())
  tenantId String
  tenant   Tenant  @relation(fields: [tenantId], references: [id])
  name     String
  email    String
  phone    String?
  address  String?
  quotes   Quote[]

  @@unique([tenantId, email])
}
```

Modify `ServiceCatalogItem`:

```prisma
model ServiceCatalogItem {
  id           String  @id @default(uuid())
  tenantId     String
  tenant       Tenant  @relation(fields: [tenantId], references: [id])
  name         String
  defaultPrice Decimal @db.Decimal(10, 2)

  @@index([tenantId])
}
```

Add `tenantId`/`tenant` to `Quote` (keep every existing field —
insert after `id`):

```prisma
model Quote {
  id       String @id @default(uuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])
  // ...(all existing fields unchanged)...

  @@index([tenantId])
}
```

Add `tenantId`/`tenant` to `Invoice` the same way, plus an index.

Add `tenantId`/`tenant` to `AuditLog` the same way (make it optional-nullable
is wrong here — keep it required, same pattern), plus an index.

Replace `CompanyProfile`:

```prisma
// One row per tenant (tenantId is the unique key) — no more fixed 'company'
// singleton id. src/lib/companyProfile.ts now upserts by tenantId.
model CompanyProfile {
  id        String   @id @default(uuid())
  tenantId  String   @unique
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  name      String?
  phone     String?
  email     String?
  address   String?
  logoPath  String?
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Generate the migration without applying it**

```bash
npx prisma migrate dev --create-only --name multi_tenant_foundation
```

This writes `prisma/migrations/<timestamp>_multi_tenant_foundation/migration.sql`
but does **not** run it — Prisma will add every new `tenantId` column as
`NOT NULL` by default, which fails immediately against tables that already
have rows. That's expected; Step 3 rewrites this file by hand before it's
applied.

- [ ] **Step 3: Hand-edit the generated `migration.sql`**

Replace its contents with (adjust exact `ADD COLUMN`/`ALTER TABLE` names to
match whatever Prisma actually generated for constraint/index names — keep
the ordering and the backfill logic below intact regardless):

```sql
-- 1. Create Tenant table and enum first (no dependents yet).
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'incomplete');

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "stripeConnectAccountId" TEXT,
    "stripeConnectChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeConnectOnboardedAt" TIMESTAMP(3),
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");
CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key" ON "Tenant"("stripeSubscriptionId");
CREATE UNIQUE INDEX "Tenant_stripeConnectAccountId_key" ON "Tenant"("stripeConnectAccountId");

-- 2. Seed exactly one grandfathered tenant for all existing production data.
--    subscriptionStatus is 'active' with no trial clock — this tenant is not
--    retroactively asked to pay or start a trial countdown.
INSERT INTO "Tenant" ("id", "name", "slug", "subscriptionStatus")
VALUES ('00000000-0000-0000-0000-000000000001', 'Tip Top Trees Ltd', 'tip-top-trees', 'active');

-- 3. Add tenantId to every tenant-owned table as NULLABLE first.
ALTER TABLE "User" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Client" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "ServiceCatalogItem" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "CompanyProfile" ADD COLUMN "tenantId" TEXT;

-- 4. Backfill every existing row onto the seeded tenant.
UPDATE "User" SET "tenantId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Client" SET "tenantId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ServiceCatalogItem" SET "tenantId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Quote" SET "tenantId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Invoice" SET "tenantId" = '00000000-0000-0000-0000-000000000001';
UPDATE "AuditLog" SET "tenantId" = '00000000-0000-0000-0000-000000000001';
-- CompanyProfile: there is at most one row (the fixed id 'company'). Point
-- it at the seeded tenant and drop the old fixed-id convention.
UPDATE "CompanyProfile" SET "tenantId" = '00000000-0000-0000-0000-000000000001' WHERE "id" = 'company';

-- 5. Now that every row has a tenantId, enforce NOT NULL + FKs + indexes.
ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Client" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "ServiceCatalogItem" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CompanyProfile" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX "ServiceCatalogItem_tenantId_idx" ON "ServiceCatalogItem"("tenantId");
CREATE INDEX "Quote_tenantId_idx" ON "Quote"("tenantId");
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");
CREATE UNIQUE INDEX "CompanyProfile_tenantId_key" ON "CompanyProfile"("tenantId");

-- 6. Client.email: drop the old global unique, add the tenant-scoped one.
--    Find the exact old constraint name first if this differs:
--    SELECT conname FROM pg_constraint WHERE conrelid = '"Client"'::regclass;
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_email_key";
CREATE UNIQUE INDEX "Client_tenantId_email_key" ON "Client"("tenantId", "email");

-- 7. CompanyProfile.id can now revert to a generated default going forward —
--    no schema change needed here since `id` was always a plain String @id;
--    only the application-level lookup convention (fixed 'company') changes,
--    handled in Task 6 (src/lib/companyProfile.ts), not in SQL.
```

- [ ] **Step 4: Apply the hand-edited migration and regenerate the client**

```bash
npx prisma migrate deploy
npm run db:generate
```

`migrate deploy` runs the SQL file verbatim (unlike `migrate dev`, it will
not try to regenerate it from the schema diff). Confirm no errors — if
`Client_email_key` isn't the actual constraint name, the `DROP CONSTRAINT IF
EXISTS` is a no-op and the later `CREATE UNIQUE INDEX` still succeeds, but
verify the old global unique is actually gone: `SELECT indexname FROM
pg_indexes WHERE tablename = 'Client';` should show
`Client_tenantId_email_key` and **not** any single-column email unique index.

- [ ] **Step 5: Verify with a one-off Prisma query**

```bash
npx tsx -e "import { prisma } from './src/lib/db'; prisma.tenant.findMany().then((t) => { console.log('tenants:', t.length); return prisma.user.count(); }).then((n) => console.log('users backfilled:', n)).finally(() => prisma.\$disconnect())"
```

Expected: `tenants: 1`, `users backfilled: <the real existing user count>` —
zero users would mean the backfill UPDATE didn't match any rows.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): multi-tenant foundation — Tenant model, tenantId backfill, tenant-scoped Client.email"
```

---

### Task 2: Session carries `tenantId` — auth callbacks, type augmentation, `requireTenantSession()`

**Files:**
- Modify: `src/lib/auth.ts`
- Create: `src/types/next-auth.d.ts`
- Test: `tests/integration/auth.test.ts` (extend)

**Interfaces:**
- Produces: `requireTenantSession(): Promise<TenantSession | null>` where
  `TenantSession = Session & { user: { id: string; tenantId: string; role:
  'admin' | 'staff' } }`. Every route rewritten in Task 4 imports this.

- [ ] **Step 1: Create `src/types/next-auth.d.ts`**

```ts
import { Role } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      tenantId: string;
      role: Role;
      name?: string | null;
      email?: string | null;
    };
  }
  interface User {
    id: string;
    tenantId: string;
    role: Role;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    tenantId: string;
    role: Role;
  }
}
```

This is NextAuth's documented module-augmentation pattern for extending
`Session`/`User`/`JWT` — see the `next-auth` TypeScript docs. It requires no
runtime code; it only makes `session.user.tenantId` type-check.

- [ ] **Step 2: Update `verifyCredentials` and the callbacks in `src/lib/auth.ts`**

```ts
export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  return { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, role: user.role };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return verifyCredentials(credentials.email, credentials.password);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.tenantId = token.tenantId;
        session.user.role = token.role;
      }
      return session;
    },
  },
};

export type TenantSession = Awaited<ReturnType<typeof getServerSession>> & {
  user: { id: string; tenantId: string; role: 'admin' | 'staff' };
};

export async function requireTenantSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) return null;
  return session as TenantSession;
}
```

Add `import { getServerSession } from 'next-auth';` to the top of the file
alongside the existing imports.

- [ ] **Step 3: Extend `tests/integration/auth.test.ts`**

Add a test confirming a logged-in session's `user.tenantId` matches the
seeded user's `tenantId` (create a `Tenant` + `User` in the test, sign in via
`verifyCredentials`, assert the returned object's `tenantId` field). Follow
the file's existing setup/teardown pattern (create in `beforeAll`, delete in
`afterAll`).

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/integration/auth.test.ts
```

Expected: PASS.

```bash
git add src/lib/auth.ts src/types/next-auth.d.ts tests/integration/auth.test.ts
git commit -m "feat(auth): session carries tenantId, add requireTenantSession() helper"
```

---

### Task 3: Signup — `Tenant` + first admin `User` in one transaction

**Files:**
- Create: `src/app/api/signup/route.ts`
- Create: `src/app/signup/page.tsx` (client form, mirrors `src/app/login/page.tsx`'s structure)
- Test: `tests/integration/signup-api.test.ts`

**Interfaces:**
- Produces: `POST /api/signup` with body `{ companyName, email, password }` →
  `{ tenantId, userId }` (201), or 400 (validation / email already used) or
  409 (slug collision, extremely unlikely but handled).
- Consumes: `bcrypt.hash` (same as `prisma/seed.ts`), a `slugify(companyName)`
  helper (new, in `src/lib/slug.ts` — lowercase, spaces→hyphens, strip
  non-alphanumerics, append a short random suffix on collision).

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/signup-api.test.ts` following the structure of
`tests/integration/profile-api.test.ts` (real Postgres, no session mock
needed here since signup is unauthenticated):

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { POST } from '@/app/api/signup/route';
import { prisma } from '@/lib/db';

describe('POST /api/signup', () => {
  const createdTenantIds: string[] = [];

  afterEach(async () => {
    for (const tenantId of createdTenantIds.splice(0)) {
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
  });

  function signup(body: unknown) {
    return POST(new Request('http://localhost/api/signup', { method: 'POST', body: JSON.stringify(body) }) as any);
  }

  it('creates a trialing Tenant and an admin User in one call', async () => {
    const res = await signup({ companyName: 'Acme Tree Co', email: `acme-${Date.now()}@example.com`, password: 'hunter2hunter2' });
    expect(res.status).toBe(201);
    const body = await res.json();
    createdTenantIds.push(body.tenantId);

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: body.tenantId } });
    expect(tenant.subscriptionStatus).toBe('trialing');
    expect(tenant.trialEndsAt).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: body.userId } });
    expect(user.role).toBe('admin');
    expect(user.tenantId).toBe(tenant.id);
  });

  it('rejects a duplicate email with 400', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const first = await signup({ companyName: 'First Co', email, password: 'hunter2hunter2' });
    createdTenantIds.push((await first.json()).tenantId);

    const second = await signup({ companyName: 'Second Co', email, password: 'hunter2hunter2' });
    expect(second.status).toBe(400);
  });

  it('rejects a short password with 400', async () => {
    const res = await signup({ companyName: 'Weak Co', email: `weak-${Date.now()}@example.com`, password: '123' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/signup-api.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/slug.ts`**

```ts
import { randomBytes } from 'crypto';

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'tenant';
}

export function uniqueSuffix(): string {
  return randomBytes(3).toString('hex');
}
```

- [ ] **Step 4: Create `src/app/api/signup/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { slugify, uniqueSuffix } from '@/lib/slug';

const TRIAL_DAYS = 14;

const signupSchema = z.object({
  companyName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { companyName, email, password } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: 'email already in use' }, { status: 400 });
  }

  let slug = slugify(companyName);
  if (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${slug}-${uniqueSuffix()}`;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const { tenant, user } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: companyName, slug, subscriptionStatus: 'trialing', trialEndsAt },
    });
    const user = await tx.user.create({
      data: { tenantId: tenant.id, name: companyName, email, passwordHash, role: 'admin' },
    });
    await tx.companyProfile.create({ data: { tenantId: tenant.id, name: companyName } });
    return { tenant, user };
  });

  return NextResponse.json({ tenantId: tenant.id, userId: user.id }, { status: 201 });
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run tests/integration/signup-api.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 6: Create `src/app/signup/page.tsx`**

Read `src/app/login/page.tsx` first and mirror its structure exactly
(client component, `'use client'`, controlled inputs, `fetch` on submit,
`signIn('credentials', ...)` from `next-auth/react` on success to log the new
user straight in, error banner on failure) — add a `companyName` field ahead
of email/password, POST to `/api/signup` instead of NextAuth's `signIn`
directly, then call `signIn('credentials', { email, password, redirect:
true, callbackUrl: '/quotes' })` once signup succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/slug.ts src/app/api/signup/route.ts src/app/signup/page.tsx tests/integration/signup-api.test.ts
git commit -m "feat(signup): public tenant signup — creates Tenant + first admin User"
```

---

### Task 4: Re-scope every authenticated API route by `tenantId`

**Files (rewrite pattern applied to all):**
- `src/app/api/quotes/route.ts` (full example below)
- `src/app/api/quotes/[id]/route.ts`
- `src/app/api/quotes/[id]/complete/route.ts`
- `src/app/api/quotes/[id]/booking/route.ts`
- `src/app/api/quotes/[id]/booking/round/route.ts`
- `src/app/api/quotes/photos/route.ts`
- `src/app/api/clients/route.ts`
- `src/app/api/clients/[id]/route.ts`
- `src/app/api/invoices/route.ts`
- `src/app/api/invoices/[id]/route.ts`
- `src/app/api/invoices/[id]/pdf/route.ts`
- `src/app/api/company/route.ts`
- `src/app/api/company/logo/route.ts`
- `src/app/api/profile/route.ts`
- `src/app/api/profile/password/route.ts`

**Interfaces:**
- Consumes: `requireTenantSession()` from Task 2.
- Every route's Prisma call gains `tenantId: session.user.tenantId` in its
  `where`. No response shape changes — this is scoping, not a feature
  change. Every existing test for these routes keeps its current
  assertions on response bodies; only its setup needs a `Tenant`/
  `tenantId` (Task 10).

- [ ] **Step 1: Full worked example — `src/app/api/quotes/route.ts`**

Replace every `getServerSession(authOptions)` call with
`requireTenantSession()`, and thread `session.user.tenantId` into every
Prisma call that touches `Quote`/`Client`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireTenantSession } from '@/lib/auth';
import { calculateTotals } from '@/lib/quoteMath';
import { sendQuoteApprovalEmail } from '@/lib/email';

// ...(quoteItemSchema, upsertQuoteSchema, ItemOwnershipConflictError unchanged)...

export async function POST(req: NextRequest) {
  const session = await requireTenantSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { tenantId } = session.user;

  const body = await req.json();
  const parsed = upsertQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const totals = calculateTotals(data.items, data.taxRate);

  // draftId is globally unique (client-generated UUID) but MUST also be
  // checked against tenantId — otherwise a cross-tenant draftId collision
  // (astronomically unlikely, but the query must express intent correctly)
  // could read another tenant's existing row here.
  const existing = await prisma.quote.findFirst({ where: { draftId: data.draftId, tenantId } });
  if (existing && data.clientUpdatedAt !== undefined && existing.updatedAt.getTime() > data.clientUpdatedAt) {
    return NextResponse.json({ error: 'conflict', serverUpdatedAt: existing.updatedAt }, { status: 409 });
  }

  const client = await prisma.client.upsert({
    where: { tenantId_email: { tenantId, email: data.clientEmail } },
    update: { name: data.clientName, phone: data.clientPhone, address: data.clientAddress },
    create: { tenantId, name: data.clientName, email: data.clientEmail, phone: data.clientPhone, address: data.clientAddress },
  });

  const userId = session.user.id;

  let quoteId: string;
  try {
    quoteId = await prisma.$transaction(async (tx) => {
      const quote = await tx.quote.upsert({
        where: { draftId: data.draftId },
        create: {
          tenantId,
          draftId: data.draftId,
          clientId: client.id,
          createdById: userId,
          subtotal: totals.subtotal,
          taxRate: data.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          serviceAddress: data.serviceAddress,
          status: data.send ? 'sent' : 'draft',
          sentAt: data.send ? new Date() : null,
        },
        update: {
          clientId: client.id,
          subtotal: totals.subtotal,
          taxRate: data.taxRate,
          taxAmount: totals.taxAmount,
          total: totals.total,
          serviceAddress: data.serviceAddress,
          ...(data.send && existing?.status === 'draft' ? { status: 'sent' as const, sentAt: new Date() } : {}),
        },
      });

      // Everything below this line (item reconciliation) is UNCHANGED — items
      // are reached via quoteId, which is already tenant-scoped by the quote
      // upsert above using `draftId` (globally unique) — no separate
      // tenantId filter needed on QuoteItem itself, matching the "no
      // duplicate tenantId column on child tables" design decision.
      // ...(existing reconciliation logic verbatim)...

      return quote.id;
    });
  } catch (err) {
    if (err instanceof ItemOwnershipConflictError) {
      return NextResponse.json({ error: 'item ownership conflict' }, { status: 409 });
    }
    throw err;
  }

  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  // ...(send-email branch unchanged)...

  return NextResponse.json({ quote }, { status: existing ? 200 : 201 });
}

export async function GET() {
  const session = await requireTenantSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quotes = await prisma.quote.findMany({
    where: { tenantId: session.user.tenantId },
    include: { client: true, items: true },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ quotes });
}
```

**Note on `client.upsert`'s `where`:** Prisma names a composite `@@unique`'s
generated `where` key by joining the field names with underscores —
`tenantId_email` for `@@unique([tenantId, email])`. Confirm the exact
generated name by checking `node_modules/.prisma/client/index.d.ts`'s
`ClientWhereUniqueInput` type (or just let TypeScript's autocomplete/error
tell you) rather than assuming — Prisma's naming convention is consistent
but this is exactly the kind of thing to verify against the actually
generated client, not assume.

- [ ] **Step 2: Run this route's existing tests**

```bash
npx vitest run tests/integration/quotes-api.test.ts tests/integration/quotes-get-api.test.ts tests/integration/quotes-delete-api.test.ts
```

Expected: FAIL until Task 10 updates these tests' setup to create a
`Tenant` first — that's fine at this point; Task 10 is later in this same
plan and must land before the full suite is green. Confirm the *failure
reason* is "tenantId required"/"foreign key violation," not something else,
before moving on.

- [ ] **Step 3: Apply the identical pattern to the remaining 14 route files**

For each file below: replace `getServerSession(authOptions)` +
`authOptions` import with `requireTenantSession()`; every direct
`prisma.<model>.findUnique({ where: { id: params.id } })` on a
tenant-owned model becomes `prisma.<model>.findFirst({ where: { id:
params.id, tenantId: session.user.tenantId } })` (switching `findUnique` →
`findFirst` because the `where` is no longer a single unique field); every
`findMany` gains `tenantId` in its `where`; every `create` gains `tenantId:
session.user.tenantId` in its `data`.

| File | Model(s) touched | Change |
|---|---|---|
| `src/app/api/quotes/[id]/route.ts` (both handlers, lines 19 & 32) | `Quote` | `findUnique({ where: { id } })` → `findFirst({ where: { id, tenantId } })` |
| `src/app/api/quotes/[id]/complete/route.ts` (line 17) | `Quote`, creates `Invoice` | scope the `findUnique`; add `tenantId` to the `Invoice` `create` |
| `src/app/api/quotes/[id]/booking/route.ts` (line 10) | `Quote` | scope `findUnique` → `findFirst` |
| `src/app/api/quotes/[id]/booking/round/route.ts` (line 30) | `Quote` | scope `findUnique` → `findFirst` |
| `src/app/api/quotes/photos/route.ts` | `QuoteItem`/`Quote` | when resolving the parent `Quote` to check ownership before accepting a photo, scope that lookup by `tenantId` |
| `src/app/api/clients/route.ts` | `Client` | list/create scoped by `tenantId` (this is `getConfirmedClients()` — see Task 5, do that one together with this route) |
| `src/app/api/clients/[id]/route.ts` (lines 31 & 56) | `Client` | scope both `findUnique` calls → `findFirst` with `tenantId` |
| `src/app/api/invoices/route.ts` (line 10) | `Invoice` | scope `findMany` |
| `src/app/api/invoices/[id]/route.ts` (lines 12, 35, 81) | `Invoice` | scope all three lookups |
| `src/app/api/invoices/[id]/pdf/route.ts` (line 15) | `Invoice` | scope the lookup |
| `src/app/api/company/route.ts` | `CompanyProfile` | see Task 6 — this route calls `getCompanyProfile()`, which changes signature |
| `src/app/api/company/logo/route.ts` | `CompanyProfile` | same — pass `tenantId` through |
| `src/app/api/profile/route.ts` (line 11) | `User` | `findUniqueOrThrow({ where: { id: session.user.id } })` needs no `tenantId` filter (a user can only ever be their own row by id) — but switch the session-null check to use `requireTenantSession()` for consistency |
| `src/app/api/profile/password/route.ts` (line 23) | `User` | same as above |

Note `src/app/api/quotes/[id]/complete/route.ts`'s `Invoice` create must add
`tenantId` — this is a `create`, not a scoping filter, but it's the same
task (every write to a tenant-owned table needs `tenantId` in its `data`,
not just every read needing it in its `where`).

`src/app/api/auth/[...nextauth]/route.ts` and `src/app/api/health/route.ts`
need no changes (NextAuth's own handler; a liveness check with no tenant
data). `src/app/api/uploads/quotes/[quoteId]/[filename]/route.ts` and
`src/app/api/uploads/company/[filename]/route.ts` are handled separately in
Task 7 (file-serving needs an ownership check, not just a query filter).
`src/app/api/portal/[token]/respond/route.ts` and
`src/app/api/portal/[token]/booking/respond/route.ts` need **no** `tenantId`
filter added to their `Quote` lookups — per the Global Constraints, portal
routes resolve by `publicToken` alone, unscoped, by design.

- [ ] **Step 4: Commit**

```bash
git add src/app/api
git commit -m "feat(api): scope every authenticated route by tenantId"
```

(This commit will not be independently green — Task 10 must land in the
same overall plan run before `npm test` passes. Commit anyway to keep this
mechanical change reviewable as its own diff, separate from the test-fixture
updates in Task 10.)

---

### Task 5: `getConfirmedClients()` and any other tenant-scoped `src/lib` helpers

**Files:**
- Modify: `src/lib/clients.ts`

**Interfaces:**
- Changes: `getConfirmedClients(): Promise<Client[]>` →
  `getConfirmedClients(tenantId: string): Promise<Client[]>`. Its one caller
  (`GET /api/clients`, from Task 4's table) passes `session.user.tenantId`.

- [ ] **Step 1: Read the current implementation and add the `tenantId` param**

Add `tenantId: string` as the function's first parameter, add `tenantId` to
the `where` clause on whatever query selects clients with a
`scheduled`/`completed` quote (the exact query already exists — only the
`where` needs one more condition, `tenantId`, ANDed with the existing
status-based filter).

- [ ] **Step 2: Update the caller in `src/app/api/clients/route.ts`**

```ts
const clients = await getConfirmedClients(session.user.tenantId);
```

- [ ] **Step 3: Run and commit**

```bash
npx vitest run tests/integration/clients-api.test.ts
git add src/lib/clients.ts src/app/api/clients/route.ts
git commit -m "feat(clients): scope getConfirmedClients by tenantId"
```

---

### Task 6: `CompanyProfile` — drop the fixed-id singleton, key by `tenantId`

**Files:**
- Modify: `src/lib/companyProfile.ts`
- Modify: `src/app/api/company/route.ts`
- Modify: `src/app/api/company/logo/route.ts`
- Modify: any server component reading company profile for the portal
  (`src/app/portal/[token]/page.tsx` — see Task 8)
- Test: `tests/integration/company-api.test.ts` (rewrite its
  snapshot/restore logic — see the CLAUDE.md warning this file already
  carries about the fixed `'company'` id)

**Interfaces:**
- Changes: `getCompanyProfile(): Promise<CompanyProfile>` →
  `getCompanyProfile(tenantId: string): Promise<CompanyProfile>`.
  `COMPANY_PROFILE_ID` constant is removed.

- [ ] **Step 1: Rewrite `src/lib/companyProfile.ts`**

```ts
import { prisma } from '@/lib/db';

export async function getCompanyProfile(tenantId: string) {
  return prisma.companyProfile.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  });
}

export function companyLogoUrl(logoPath: string | null): string | null {
  return logoPath ? `/api/uploads/company/${logoPath}` : null;
}
```

- [ ] **Step 2: Update `src/app/api/company/route.ts` and `logo/route.ts`**

Both already call `requireTenantSession()` per Task 4's table — pass
`session.user.tenantId` into `getCompanyProfile(...)` and into whatever
`prisma.companyProfile.update(...)` call persists edits (its `where` becomes
`{ tenantId: session.user.tenantId }` instead of the old fixed id).

- [ ] **Step 3: Rewrite `tests/integration/company-api.test.ts`**

The file's existing comment (carried over from `CLAUDE.md`) warns against
`deleteMany`/`rmSync`-ing the fixed `'company'` row because it used to be
the SAME row a real deployment edits. That risk is now gone — every test
tenant gets its own `CompanyProfile` row keyed by a test-created `tenantId`,
so the suite can freely `create`/`delete` its own tenant's row without
touching any real deployment's data. Rewrite the test's `beforeAll`/
`beforeEach`/`afterAll` to: create a real `Tenant` + admin `User` in
`beforeAll`, mock `getServerSession` to return that user/tenant, and
`afterAll` deletes the whole tenant (cascades are not set up for `Tenant` →
its children by design — this plan's schema uses `onDelete: Restrict`
implicitly via Prisma's default, so delete children first: `companyProfile`,
then `user`, then `tenant`). Drop the old file-snapshot-and-restore
machinery entirely — it existed only because of the shared-singleton risk
this task removes.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/integration/company-api.test.ts
git add src/lib/companyProfile.ts src/app/api/company src/app/api/company tests/integration/company-api.test.ts
git commit -m "feat(company): CompanyProfile keyed by tenantId, drop fixed-id singleton"
```

---

### Task 7: Upload-serving routes — add tenant ownership checks

**Files:**
- Modify: `src/app/api/uploads/quotes/[quoteId]/[filename]/route.ts`
- Modify: `src/app/api/uploads/company/[filename]/route.ts`
- Test: `tests/integration/uploads-serve-api.test.ts` (extend)

**Interfaces:**
- Both routes currently serve a file straight off disk given only the
  URL params. They must confirm the requesting session's `tenantId` owns
  the `Quote`/`CompanyProfile` the file belongs to before streaming it —
  otherwise a valid staff session at Tenant A could read Tenant B's uploaded
  photos/logo just by guessing/observing a `quoteId` or `filename`.

- [ ] **Step 1: Read both route files in full to see their current param handling**

(Do this before writing the check — the exact lookup needed depends on
whether `filename` alone is globally unique or only unique per quote/tenant;
confirm from the existing `QuotePhoto.filePath` / `CompanyProfile.logoPath`
storage convention before assuming.)

- [ ] **Step 2: Add a `requireTenantSession()` check + ownership lookup to each**

Quotes uploads route: before reading the file, `prisma.quote.findFirst({
where: { id: params.quoteId, tenantId: session.user.tenantId } })` — 404 if
not found (do not distinguish "wrong tenant" from "doesn't exist" in the
response, to avoid leaking existence of another tenant's quote id).

Company logo route: `prisma.companyProfile.findFirst({ where: { tenantId:
session.user.tenantId, logoPath: params.filename } })` — 404 if not found.

- [ ] **Step 3: Extend `tests/integration/uploads-serve-api.test.ts`**

Add a test per route: create two tenants, upload/attach a file under
Tenant A, assert a session authenticated as a Tenant B user gets 404 (not
200) when requesting Tenant A's file path directly.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/integration/uploads-serve-api.test.ts
git add src/app/api/uploads tests/integration/uploads-serve-api.test.ts
git commit -m "fix(uploads): enforce tenant ownership before serving quote photos and company logo"
```

---

### Task 8: Server components that query Prisma directly

**Files:**
- Modify: `src/app/invoices/page.tsx`
- Modify: `src/app/invoices/[id]/page.tsx`
- Modify: `src/app/portal/[token]/page.tsx`

**Interfaces:**
- The two `/invoices` pages already declare `export const dynamic =
  'force-dynamic'` (per `CLAUDE.md` — required for Next to not statically
  prerender a Prisma-backed page). They call `getServerSession(authOptions)`
  today; switch to `requireTenantSession()` and add `tenantId` to their
  `prisma.invoice.findMany`/`findUnique` calls, same pattern as Task 4.
- `src/app/portal/[token]/page.tsx` has no session (public) — its `Quote`
  lookup by `publicToken` stays unscoped, but wherever it currently calls
  `getCompanyProfile()` (no-arg, old signature) it must now pass
  `quote.tenantId` — this is the one place `tenantId` flows *out of* an
  unscoped lookup rather than gating one.

- [ ] **Step 1: Update `src/app/invoices/page.tsx` and `src/app/invoices/[id]/page.tsx`**

Same mechanical change as Task 4's table — `requireTenantSession()`, add
`tenantId` to the `where`.

- [ ] **Step 2: Update `src/app/portal/[token]/page.tsx`**

Change `getCompanyProfile()` → `getCompanyProfile(quote.tenantId)`, called
after the existing `prisma.quote.findUnique({ where: { publicToken } })`
resolves.

- [ ] **Step 3: Manual verification (no existing E2E-level test covers this exact page pairing)**

Run `npm run dev`, sign in as the seeded admin, visit `/invoices`; separately
visit a `/portal/<token>` link for an existing quote and confirm the
company branding still renders. Document in the commit message that this
step was done, since there's no automated coverage for it yet.

- [ ] **Step 4: Commit**

```bash
git add src/app/invoices src/app/portal
git commit -m "feat(pages): scope invoices pages by tenantId, portal resolves CompanyProfile via quote.tenantId"
```

---

### Task 9: Tenant isolation integration test (the actual proof this works)

**Files:**
- Create: `tests/integration/tenant-isolation.test.ts`

**Interfaces:**
- This is the verification step the design doc calls out as mandatory
  before either Stripe plan starts. It does not test any new endpoint — it
  re-exercises the existing list/get endpoints from two different tenants'
  sessions and asserts zero cross-contamination.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET as getQuotes } from '@/app/api/quotes/route';
import { GET as getClients } from '@/app/api/clients/route';
import { GET as getInvoices } from '@/app/api/invoices/route';
import { prisma } from '@/lib/db';

describe('Tenant isolation', () => {
  let tenantA: { id: string; userId: string; clientId: string };
  let tenantB: { id: string; userId: string; clientId: string };

  async function seedTenant(label: string) {
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Co`, slug: `${label.toLowerCase()}-${randomUUID()}` },
    });
    const user = await prisma.user.create({
      data: { tenantId: tenant.id, name: `${label} Staff`, email: `${label.toLowerCase()}-${randomUUID()}@example.com`, passwordHash: 'x', role: 'admin' },
    });
    const client = await prisma.client.create({
      data: { tenantId: tenant.id, name: `${label} Client`, email: `${label.toLowerCase()}client-${randomUUID()}@example.com` },
    });
    await prisma.quote.create({
      data: {
        tenantId: tenant.id,
        draftId: randomUUID(),
        clientId: client.id,
        createdById: user.id,
        items: { create: [{ localItemId: randomUUID(), title: `${label} job`, price: 100, sortOrder: 0 }] },
      },
    });
    return { id: tenant.id, userId: user.id, clientId: client.id };
  }

  beforeAll(async () => {
    tenantA = await seedTenant('TenantA');
    tenantB = await seedTenant('TenantB');
  });

  afterAll(async () => {
    for (const t of [tenantA, tenantB]) {
      await prisma.quote.deleteMany({ where: { tenantId: t.id } });
      await prisma.client.deleteMany({ where: { tenantId: t.id } });
      await prisma.user.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.delete({ where: { id: t.id } });
    }
  });

  function asUser(userId: string, tenantId: string) {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: userId, tenantId, role: 'admin' },
    });
  }

  it('GET /api/quotes only returns the calling tenant\'s quotes', async () => {
    asUser(tenantA.userId, tenantA.id);
    const res = await getQuotes();
    const body = await res.json();
    expect(body.quotes.length).toBeGreaterThan(0);
    expect(body.quotes.every((q: any) => q.tenantId === tenantA.id)).toBe(true);
  });

  it('GET /api/clients never leaks another tenant\'s client', async () => {
    asUser(tenantB.userId, tenantB.id);
    const res = await getClients();
    const body = await res.json();
    expect(body.clients.some((c: any) => c.id === tenantA.clientId)).toBe(false);
  });

  it('GET /api/invoices scoped per tenant returns empty for a tenant with no invoices', async () => {
    asUser(tenantA.userId, tenantA.id);
    const res = await getInvoices();
    const body = await res.json();
    expect(Array.isArray(body.invoices)).toBe(true);
    expect(body.invoices.every((i: any) => i.tenantId === tenantA.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run tests/integration/tenant-isolation.test.ts
```

Expected: PASS. If any assertion fails, that is a real cross-tenant leak —
stop and fix the specific route named in Task 4's table before proceeding to
Task 10, do not paper over it in the test.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/tenant-isolation.test.ts
git commit -m "test: tenant isolation across quotes/clients/invoices list endpoints"
```

---

### Task 10: Fix the existing test suite's fixtures for `tenantId`

**Files:**
- Modify every file under `tests/integration/*.test.ts` and
  `tests/unit/*.test.ts` that creates a `User`, `Client`, `Quote`,
  `Invoice`, `ServiceCatalogItem`, or `AuditLog` row directly via Prisma or
  via the seed helper.
- Modify: `prisma/seed.ts`

**Interfaces:**
- No production code changes here — every test file's setup gains "create a
  `Tenant` first, use its id everywhere the fixture previously omitted
  `tenantId`."

- [ ] **Step 1: Update `prisma/seed.ts`**

```ts
async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'tip-top-trees' },
    update: {},
    create: { name: 'Tip Top Trees Ltd', slug: 'tip-top-trees', subscriptionStatus: 'active' },
  });
  const passwordHash = await bcrypt.hash('changeme123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@tiptoptreesltd.com' },
    update: {},
    create: { tenantId: tenant.id, name: 'Admin', email: 'admin@tiptoptreesltd.com', passwordHash, role: 'admin' },
  });
}
```

- [ ] **Step 2: Go through each integration test file and add a `Tenant`**

For every file listed by:

```bash
grep -rl "prisma.user.create\|prisma.client.create\|prisma.quote.create" tests/
```

Add a `Tenant` creation in `beforeAll` (mirroring the pattern already
established in Task 9's `seedTenant` helper — consider extracting a shared
`tests/helpers/seedTenant.ts` once you see the same 8-line block repeated
across more than two or three files, rather than copy-pasting it into every
one), thread `tenant.id` into every `tenantId` field the schema now
requires, and add the `Tenant` row to that file's `afterAll` cleanup
(deleting the tenant after deleting its dependent rows, matching the FK
`RESTRICT` behavior chosen in Task 1).

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: **all tests pass**, including every existing file
(`quotes-api.test.ts`, `quotes-get-api.test.ts`, `quotes-delete-api.test.ts`,
`portal-respond-api.test.ts`, `booking-round-api.test.ts`,
`booking-respond-api.test.ts`, `profile-api.test.ts`,
`quotes-complete-api.test.ts`, `clients-api.test.ts`,
`invoices-api.test.ts`, `photos-api.test.ts`, `uploads-serve-api.test.ts`,
`auth.test.ts`) plus the two new files from Tasks 3 and 9. This is the
actual completion gate for this whole plan — do not consider the foundation
"done" while any test is red.

- [ ] **Step 4: Commit**

```bash
git add tests prisma/seed.ts
git commit -m "test: backfill tenantId into every existing test fixture"
```

---

## Final verification checklist

- [ ] `npm test` — full suite green.
- [ ] `npm run build` — production build succeeds (confirms no leftover
  `getServerSession`/`authOptions` imports or `COMPANY_PROFILE_ID` reference
  broke a type anywhere `tsc` would catch at build time).
- [ ] `npx prisma studio` — manually confirm the seeded/grandfathered tenant
  owns every pre-existing row, and that a fresh `/signup` creates a second,
  fully isolated tenant.
- [ ] Re-read `docs/superpowers/specs/2026-07-18-multi-tenant-saas-design.md`
  "Explicitly out of scope" section — confirm nothing in this plan silently
  grew beyond it (no subdomain routing, no RBAC beyond `admin`/`staff`).
