# Per-User Isolation, Administration, Feature Flags, and Timesheet Implementation Plan

> **For agentic workers:** Read `docs/superpowers/specs/2026-09-04-per-user-isolation-and-timesheet.md` and `CLAUDE.md` before implementation. Execute tasks in order. Every step uses checkbox syntax so the Programmer can track progress. This plan is intentionally scoped to the current single-tenant deployment and must not introduce `Tenant` or `tenantId`; add a follow-up comment where ownership helpers will later also receive `tenantId`.

**Goal:** Enforce user ownership for clients, quotes, invoices, and timesheet
entries; add administrator user management, view-as access, status controls,
feature flags, per-user company profiles, and manual timesheet-to-invoice
generation without regressing the offline-first quote pipeline or public
portal.

**Recommended architecture:** Reuse `Invoice` with `source: quote | timesheet`,
nullable `quoteId`, required `userId` and `clientId`, and immutable
`InvoiceLineItem` rows for timesheet invoices. This keeps one invoice list,
payment-status flow, PDF route, and future payment surface. A separate
timesheet-invoice model would reduce the first migration but fragment the user
experience and duplicate invoice behavior.

## Global constraints

- All user-facing strings added by implementation must be English.
- Money and rates remain Prisma `Decimal`; do not use JavaScript floating-point
  arithmetic for persisted totals.
- Do not store runtime-generated logos or photos under `public/`; preserve the
  existing route-handler upload serving behavior.
- Do not add ownership fields to Dexie payloads sent by clients as authority;
  the server derives the effective owner from the session/view-as context.
- Public portal pages, portal response routes, and upload-serving routes remain
  unauthenticated by design. Their UUID/token/file-path trust model is not an
  authenticated staff list or edit surface; do not add a session requirement
  that would break client approval pages.
- Every authenticated mutation executed while an admin views another user
  must append an `AuditLog` row with the real admin `actorId` and explicit
  `targetUserId`.
- The future SaaS pivot can later add `tenantId` to these tables and helpers;
  use `userId`, `ownerUserId`, `createdById`, and `targetUserId` names only.
- Integration tests use real Postgres and must clean only rows created by the
  test. After `CompanyProfile` becomes per-user, never restore/delete a shared
  fixed-id row.

---

### Task 1: Prisma schema and safe hand-written migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create/hand-edit: `prisma/migrations/<timestamp>_per_user_isolation_timesheet/migration.sql`

**Produces:** `UserStatus`, `FeatureKey`, `InvoiceSource`,
`TimesheetEntryStatus`, `TimesheetEntry`, `TimesheetProduct`,
`InvoiceLineItem`, `UserFeatureFlag`, user ownership/profile fields, and
nullable quote-or-timesheet invoices.

- [ ] **Step 1: Update the Prisma schema.**

Add these enums:

```prisma
enum UserStatus {
  active
  inactive
  blocked
}

enum FeatureKey {
  invoices
  timesheet
  clients_crm
}

enum InvoiceSource {
  quote
  timesheet
}

enum TimesheetEntryStatus {
  open
  invoiced
}
```

Modify `User` with `status UserStatus @default(active)`,
`hourlyRate Decimal @db.Decimal(10, 2) @default(0)`, and relations for owned
clients, invoices, timesheet entries, feature flags, and authored quotes.
Modify `Client` with required `userId`, `user User`, owned timesheet entries,
and `@@unique([userId, email])`; remove `email @unique`. Keep an index on
`userId`.

Keep `Quote.createdById` as its owner, add an index on `createdById`, and add a
comment that the future `Tenant` migration will add `tenantId` alongside this
owner relation. Do not change `QuoteItem`, `QuotePhoto`, or scheduling child
ownership fields.

Replace the fixed-id `CompanyProfile` shape with `id @default(uuid())`,
required `userId @unique`, and its user relation. Keep branding fields and
`logoPath` unchanged.

Modify `Invoice` as follows while preserving all existing totals/payment
fields:

```prisma
source          InvoiceSource @default(quote)
quoteId         String?       @unique
quote           Quote?
userId          String
user            User          @relation(fields: [userId], references: [id])
clientId        String
client          Client        @relation(fields: [clientId], references: [id])
serviceAddress  String?
lineItems       InvoiceLineItem[]
timesheetEntries TimesheetEntry[]
```

Add `targetUserId String?` to `AuditLog`; leave `actorId` nullable for system
events and add indexes for `actorId`, `targetUserId`, and `createdAt` as useful.

Add:

```prisma
model UserFeatureFlag {
  id      String     @id @default(uuid())
  userId  String
  user    User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  feature FeatureKey
  enabled Boolean    @default(false)
  @@unique([userId, feature])
  @@index([userId])
}

model TimesheetEntry {
  id              String               @id @default(uuid())
  userId          String
  user            User                 @relation(fields: [userId], references: [id])
  clientId        String
  client          Client               @relation(fields: [clientId], references: [id])
  workDate        DateTime             @db.Date
  startedAt       DateTime
  endedAt         DateTime
  durationMinutes Int
  hourlyRate      Decimal              @db.Decimal(10, 2)
  status          TimesheetEntryStatus @default(open)
  invoiceId       String?
  invoice         Invoice?             @relation(fields: [invoiceId], references: [id])
  products        TimesheetProduct[]
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt
  @@index([userId, workDate])
  @@index([clientId, workDate])
  @@index([invoiceId])
}

model TimesheetProduct {
  id              String         @id @default(uuid())
  timesheetEntryId String
  timesheetEntry   TimesheetEntry @relation(fields: [timesheetEntryId], references: [id], onDelete: Cascade)
  name            String
  quantity        Decimal        @db.Decimal(10, 3)
  unitPrice       Decimal        @db.Decimal(10, 2)
  lineTotal       Decimal        @db.Decimal(10, 2)
}

model InvoiceLineItem {
  id              String         @id @default(uuid())
  invoiceId       String
  invoice         Invoice        @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  sourceEntryId   String?
  description     String
  quantity        Decimal        @db.Decimal(10, 3)
  unitPrice       Decimal        @db.Decimal(10, 2)
  amount          Decimal        @db.Decimal(10, 2)
  sortOrder       Int            @default(0)
}
```

Use explicit relation names only if Prisma reports ambiguity during
`prisma validate`; do not add redundant `tenantId` fields.

- [ ] **Step 2: Generate without applying.**

```bash
npx prisma migrate dev --create-only --name per_user_isolation_timesheet
```

- [ ] **Step 3: Replace the generated SQL with a safe nullable/backfill/not-null migration.**

The final file must preserve existing rows and execute in this order. Keep
Prisma’s exact constraint naming where it differs, but retain every backfill
and guard below.

```sql
-- New enum types before columns/tables use them.
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'blocked');
CREATE TYPE "FeatureKey" AS ENUM ('invoices', 'timesheet', 'clients_crm');
CREATE TYPE "InvoiceSource" AS ENUM ('quote', 'timesheet');
CREATE TYPE "TimesheetEntryStatus" AS ENUM ('open', 'invoiced');

-- Add existing-table columns nullable first; live rows are backfilled below.
ALTER TABLE "User" ADD COLUMN "status" "UserStatus";
ALTER TABLE "User" ADD COLUMN "hourlyRate" DECIMAL(10,2);
ALTER TABLE "Client" ADD COLUMN "userId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "source" "InvoiceSource";
ALTER TABLE "Invoice" ADD COLUMN "userId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "serviceAddress" TEXT;
ALTER TABLE "Invoice" ALTER COLUMN "quoteId" DROP NOT NULL;
ALTER TABLE "CompanyProfile" ADD COLUMN "userId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "targetUserId" TEXT;

-- The existing deployment must contain this admin. Fail instead of assigning
-- rows to an arbitrary user if that invariant is false.
DO $$
DECLARE admin_id TEXT;
BEGIN
  SELECT "id" INTO admin_id FROM "User"
  WHERE "email" = 'admin@tiptoptreesltd.com' LIMIT 1;
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'Cannot backfill per-user ownership: seeded admin is missing';
  END IF;

  UPDATE "User" SET "status" = 'active', "hourlyRate" = 0;
  UPDATE "CompanyProfile" SET "userId" = admin_id WHERE "userId" IS NULL;
  IF NOT EXISTS (SELECT 1 FROM "CompanyProfile") THEN
    INSERT INTO "CompanyProfile" ("id", "userId", "updatedAt")
    VALUES ('company', admin_id, CURRENT_TIMESTAMP);
  END IF;
END $$;

-- A legacy Client may have quotes authored by multiple users. Clone the
-- client once per owner before enforcing ownership; the original row is used
-- for the lexicographically first owner. Clients without quotes belong to the
-- existing admin so no row is left ownerless.
CREATE TEMP TABLE "_ClientOwnerMap" (
  "originalClientId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "mappedClientId" TEXT NOT NULL,
  PRIMARY KEY ("originalClientId", "ownerUserId")
) ON COMMIT DROP;

WITH pairs AS (
  SELECT DISTINCT c."id" AS "originalClientId", q."createdById" AS "ownerUserId"
  FROM "Client" c JOIN "Quote" q ON q."clientId" = c."id"
  UNION
  SELECT c."id", u."id"
  FROM "Client" c
  CROSS JOIN LATERAL (
    SELECT "id" FROM "User"
    WHERE "email" = 'admin@tiptoptreesltd.com' LIMIT 1
  ) u
  WHERE NOT EXISTS (SELECT 1 FROM "Quote" q WHERE q."clientId" = c."id")
), ranked AS (
  SELECT p.*, ROW_NUMBER() OVER (
    PARTITION BY p."originalClientId" ORDER BY p."ownerUserId"
  ) AS rn
  FROM pairs p
)
INSERT INTO "_ClientOwnerMap" ("originalClientId", "ownerUserId", "mappedClientId")
SELECT "originalClientId", "ownerUserId",
       CASE WHEN rn = 1 THEN "originalClientId"
            ELSE md5(random()::text || clock_timestamp()::text || "originalClientId" || "ownerUserId")
       END
FROM ranked;

UPDATE "Client" c SET "userId" = m."ownerUserId"
FROM "_ClientOwnerMap" m
WHERE m."originalClientId" = c."id" AND m."mappedClientId" = c."id";

INSERT INTO "Client" ("id", "name", "email", "phone", "address", "userId")
SELECT m."mappedClientId", c."name", c."email", c."phone", c."address", m."ownerUserId"
FROM "Client" c JOIN "_ClientOwnerMap" m ON m."originalClientId" = c."id"
WHERE m."mappedClientId" <> c."id";

UPDATE "Quote" q SET "clientId" = m."mappedClientId"
FROM "_ClientOwnerMap" m
WHERE m."originalClientId" = q."clientId" AND m."ownerUserId" = q."createdById";

-- Existing invoices are quote invoices; inherit all ownership/snapshot data.
UPDATE "Invoice" i SET
  "source" = 'quote',
  "userId" = q."createdById",
  "clientId" = q."clientId",
  "serviceAddress" = q."serviceAddress"
FROM "Quote" q WHERE q."id" = i."quoteId";

ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "User" ALTER COLUMN "hourlyRate" SET DEFAULT 0;
ALTER TABLE "Invoice" ALTER COLUMN "source" SET DEFAULT 'quote';
ALTER TABLE "User" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "hourlyRate" SET NOT NULL;
ALTER TABLE "Client" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "CompanyProfile" ALTER COLUMN "userId" SET NOT NULL;

-- Current Client.email uniqueness was created as an index, not a constraint.
DROP INDEX IF EXISTS "Client_email_key";
CREATE UNIQUE INDEX "Client_userId_email_key" ON "Client" ("userId", "email");

CREATE TABLE "UserFeatureFlag" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "feature" "FeatureKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "UserFeatureFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserFeatureFlag_userId_feature_key" ON "UserFeatureFlag" ("userId", "feature");
CREATE INDEX "UserFeatureFlag_userId_idx" ON "UserFeatureFlag" ("userId");

-- Preserve access to all existing optional functionality.
INSERT INTO "UserFeatureFlag" ("id", "userId", "feature", "enabled")
SELECT md5(u."id" || f.feature::text), u."id", f.feature, true
FROM "User" u CROSS JOIN (VALUES
  ('invoices'::"FeatureKey"), ('timesheet'::"FeatureKey"), ('clients_crm'::"FeatureKey")
) f(feature);

CREATE TABLE "TimesheetEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "hourlyRate" DECIMAL(10,2) NOT NULL,
  "status" "TimesheetEntryStatus" NOT NULL DEFAULT 'open',
  "invoiceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TimesheetEntry_time_check" CHECK ("endedAt" > "startedAt")
);
CREATE INDEX "TimesheetEntry_userId_workDate_idx" ON "TimesheetEntry" ("userId", "workDate");
CREATE INDEX "TimesheetEntry_clientId_workDate_idx" ON "TimesheetEntry" ("clientId", "workDate");
CREATE INDEX "TimesheetEntry_invoiceId_idx" ON "TimesheetEntry" ("invoiceId");

CREATE TABLE "TimesheetProduct" (
  "id" TEXT NOT NULL,
  "timesheetEntryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unitPrice" DECIMAL(10,2) NOT NULL,
  "lineTotal" DECIMAL(10,2) NOT NULL,
  CONSTRAINT "TimesheetProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceLineItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "sourceEntryId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(10,3) NOT NULL,
  "unitPrice" DECIMAL(10,2) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD CONSTRAINT "User_status_check" CHECK ("status" IN ('active','inactive','blocked'));
ALTER TABLE "UserFeatureFlag" ADD CONSTRAINT "UserFeatureFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimesheetProduct" ADD CONSTRAINT "TimesheetProduct_timesheetEntryId_fkey" FOREIGN KEY ("timesheetEntryId") REFERENCES "TimesheetEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CompanyProfile_userId_key" ON "CompanyProfile" ("userId");
CREATE INDEX "Client_userId_idx" ON "Client" ("userId");
CREATE INDEX "Invoice_userId_idx" ON "Invoice" ("userId");
CREATE INDEX "Invoice_clientId_idx" ON "Invoice" ("clientId");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog" ("actorId");
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog" ("targetUserId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
```

Before applying, verify generated names and that the clone/update statements
produce one owner mapping per quote. Do not replace the SQL with a blind
`prisma migrate dev` against production data.

- [ ] **Step 4: Apply and validate.**

```bash
npx prisma migrate deploy
npm run db:generate
npx prisma validate
```

Run read-only checks: no null `User.status/hourlyRate`, `Client.userId`,
`Invoice.userId/clientId`, or `CompanyProfile.userId`; no duplicate
`(userId,email)` pairs; every existing invoice has `source = 'quote'` and
matches its quote owner/client.

- [ ] **Step 5: Commit the schema/migration.**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add per-user ownership and timesheet invoice schema"
```

---

### Task 2: Authentication status, effective-user scope, and feature helpers

**Files:**

- Modify: `src/lib/auth.ts`
- Modify: `src/types/next-auth.d.ts`
- Create: `src/lib/userScope.ts`
- Create: `src/lib/features.ts`
- Create: `src/app/api/view-context/route.ts`
- Modify: `src/app/login/page.tsx`
- Test: `tests/integration/auth.test.ts`, `tests/integration/user-scope.test.ts`

- [ ] **Step 1: Extend auth data and reject disabled accounts.**

Return `status` from the user lookup internally, but do not put password data
in the session. After bcrypt succeeds, throw stable errors `Account is
inactive.` or `Account is blocked.` for those statuses; preserve `null` for
unknown email/wrong password. Update the login page to show those clear
messages instead of always showing `Invalid email or password`. Include the
active user’s role and ID in JWT/session as today.

- [ ] **Step 2: Implement `requireUserScope()`.**

Resolve the real session, re-read the actor’s current role/status, reject a
non-active actor, then read the HttpOnly `arbostar-view-as-user` cookie. Only
an active-session admin may use it; validate the target ID exists before
returning the scope. A staff session must ignore/clear any stale cookie. Add a
comment: “When `Tenant` exists, this scope also gains `tenantId`.”

Use `ownerUserId` for all data queries. Provide a small helper such as
`auditScopedMutation(scope, entityType, entityId, action)` that inserts an
`AuditLog` row only when `scope.isViewAs` is true, with `actorId` set to the
real admin and `targetUserId` set to `ownerUserId`.

- [ ] **Step 3: Implement feature checks.**

`quotes` always returns enabled. For optional features, read
`UserFeatureFlag` by `ownerUserId`; missing rows are disabled for newly created
users. Provide a route-friendly helper that returns a 403 JSON response with
an English error such as `This feature is not enabled for your account.`

- [ ] **Step 4: Add `GET /api/view-context`.**

Return actor ID/role, effective owner ID, `isViewAs`, target display name, and
the three optional feature booleans. This is the single client-side source for
Header, quote Dexie namespacing, and conditional navigation.

- [ ] **Step 5: Add unit/integration coverage and commit.**

Cover active/inactive/blocked credential behavior, staff cannot honor a
view-as cookie, admin can resolve a target, non-admin cannot set scope, and a
scoped mutation creates `AuditLog` with real actor plus target. Run:

```bash
npx vitest run tests/integration/auth.test.ts tests/integration/user-scope.test.ts
git add src/lib/auth.ts src/lib/userScope.ts src/lib/features.ts src/types/next-auth.d.ts src/app/api/view-context/route.ts src/app/login/page.tsx tests/integration/auth.test.ts tests/integration/user-scope.test.ts
git commit -m "feat(auth): enforce user status and resolve admin effective-user scope"
```

---

### Task 3: Namespace the offline-first quote pipeline by owner

**Files:**

- Modify: `src/lib/localDb.ts`
- Modify: `src/lib/outbox.ts`
- Modify: `src/lib/syncWorker.ts`
- Modify: `src/lib/pullServerQuotes.ts`
- Modify: `src/lib/pendingDeletes.ts`
- Modify: `src/lib/deleteQuote.ts`
- Modify: `src/components/QuoteBuilderForm.tsx`
- Modify: `src/app/quotes/page.tsx`
- Modify: `src/app/quotes/new/page.tsx`
- Modify: `src/app/quotes/[draftId]/page.tsx`
- Modify: `src/lib/photoSync.ts`
- Tests: `tests/unit/localDb.test.ts`, `tests/unit/outbox.test.ts`,
  `tests/unit/syncWorker.test.ts`, `tests/unit/pullServerQuotes.test.ts`,
  `tests/unit/QuoteBuilderForm.test.tsx`

- [ ] **Step 1: Add Dexie owner fields and a schema version.**

Add required `ownerUserId` to persisted `DraftQuote`, `OutboxEntry`, and any
pending-delete metadata that needs to distinguish users. Add an indexed
`ownerUserId` field in a new Dexie version. On upgrade, leave missing owners
marked as legacy rather than guessing inside the database migration.

- [ ] **Step 2: Add authenticated context bootstrap.**

Fetch `/api/view-context` before rendering user-scoped quote lists/builders.
On the first authenticated load, assign legacy draft/outbox rows with no owner
to the current effective owner exactly once, then filter every live query by
that owner. A draft URL with a row owned by another user must render “Draft not
found” and never expose its contents.

- [ ] **Step 3: Thread owner through every offline operation.**

Update `enqueueSync`, `dueEntries`, `pullServerQuotes`, delete queues, photo
uploads, and `runSyncCycle` to use the effective owner. The sync POST must still
send only quote form data; the server uses its authenticated scope. Ensure an
admin viewing user B syncs only B’s local drafts and never drains another
owner’s outbox.

- [ ] **Step 4: Verify offline invariants.**

Add tests for two owners sharing one browser: each sees only its own drafts,
outbox entries, pending deletes, and pulled server quotes; a legacy row is
claimed once; a view-as switch cannot read the prior user’s local draft; and
photo IDs remain attached during owner-filtered pull/reconciliation. Run:

```bash
npx vitest run tests/unit/localDb.test.ts tests/unit/outbox.test.ts tests/unit/syncWorker.test.ts tests/unit/pullServerQuotes.test.ts tests/unit/QuoteBuilderForm.test.tsx
git add src/lib src/components/QuoteBuilderForm.tsx src/app/quotes tests/unit
git commit -m "feat(offline): namespace drafts and sync queues by user owner"
```

---

### Task 4: Admin users, feature flags, and view-as controls

**Files:**

- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts`
- Create: `src/app/api/admin/users/[id]/features/route.ts`
- Create: `src/app/api/admin/view-as/route.ts`
- Create: `src/app/admin/users/page.tsx`
- Create: `src/components/AdminUsersClient.tsx`
- Create: `src/app/admin/users/admin-users.module.css`
- Modify: `src/components/Header.tsx`, `src/components/Header.module.css`
- Modify: `src/middleware.ts`
- Tests: `tests/integration/admin-users-api.test.ts`,
  `tests/integration/feature-flags-api.test.ts`

- [ ] **Step 1: Implement admin authorization.**

Centralize an `requireAdminSession()` check using the real actor, not the
effective owner. Return 401 when unauthenticated and 403 for staff. Add
`/admin/:path*` and `/timesheet/:path*` to middleware authentication matching;
feature checks remain server-side, not in Edge middleware.

- [ ] **Step 2: Implement user CRUD/status endpoints.**

`POST /api/admin/users` validates name, email, initial password, role, and
status, hashes the password, creates an active/inactive/blocked user, and
optionally creates requested feature rows. `GET` lists users with status,
role, hourly rate, and feature values but never password hashes. `PATCH
/api/admin/users/[id]` edits safe fields and can reset a password. Guard against
disabling/blocking the last active admin and against self-lockout; write an
audit row for these administrative actions as normal admin audit events.

- [ ] **Step 3: Implement feature endpoints.**

`PATCH /api/admin/users/[id]/features` validates only `invoices`, `timesheet`,
and `clients_crm`, upserts `(userId, feature)`, and returns the complete flag
set. Reject `quotes` as a flag because quotes are always enabled.

- [ ] **Step 4: Implement view-as cookie endpoints.**

`POST /api/admin/view-as` validates a target user and sets the HttpOnly,
same-site cookie. `DELETE` clears it. Never accept an owner ID in ordinary
data APIs. After changing context, refresh server components and refetch
`/api/view-context`.

- [ ] **Step 5: Build the admin UI.**

Add an admin-only Users navigation entry and a page that creates users, edits
status/role/password/hourly rate, and toggles feature flags. Add a compact
admin-only view-as selector and “Stop viewing” action in the protected Header;
it must be visible on clients, quotes, invoices, and timesheet pages. Display a
clear “Viewing as …” indicator so destructive actions are not ambiguous.

- [ ] **Step 6: Test and commit.**

Test staff 403s, duplicate emails, password hashing, all statuses, last-admin
guards, feature validation, cookie set/clear, and that a view-as admin can
read/write target data while recording audit metadata.

```bash
npx vitest run tests/integration/admin-users-api.test.ts tests/integration/feature-flags-api.test.ts
git add src/app/api/admin src/app/admin src/components/Header* src/middleware.ts tests/integration/admin-users-api.test.ts tests/integration/feature-flags-api.test.ts
git commit -m "feat(admin): add user management, feature flags, and view-as controls"
```

---

### Task 5: Per-user billing profile and profile settings

**Files:**

- Modify: `src/lib/companyProfile.ts`
- Modify: `src/app/api/company/route.ts`
- Modify: `src/app/api/company/logo/route.ts`
- Modify: `src/app/api/profile/route.ts`
- Modify: `src/app/api/profile/password/route.ts`
- Modify: `src/app/profile/page.tsx`, `src/app/profile/profile.module.css`
- Modify: `src/app/api/quotes/[id]/complete/route.ts`
- Modify: `src/app/api/invoices/[id]/route.ts`
- Modify: `src/app/api/invoices/[id]/pdf/route.ts`
- Modify: `src/app/invoices/[id]/page.tsx`
- Modify: `src/app/portal/[token]/page.tsx`
- Modify: `src/lib/invoicePdf.ts`, `src/lib/email.ts`
- Test: `tests/integration/company-api.test.ts`, `tests/integration/profile-api.test.ts`

- [ ] **Step 1: Change the profile helper signature.**

Implement `getCompanyProfile(userId)` with `upsert({ where: { userId }, ... })`
and remove `COMPANY_PROFILE_ID`. Authenticated company routes use the effective
owner and call `auditScopedMutation` after successful writes. Logo upload and
deletion still use `uploads/company/` and the existing route handler.

- [ ] **Step 2: Separate personal settings from billing branding.**

`/api/profile` and password changes remain actor-owned personal settings;
admins manage another user’s password/status through admin endpoints. The
company-profile section uses the effective owner so an admin view-as can edit
that user’s billing identity. Add `hourlyRate` to the profile GET/PATCH with
Decimal-safe validation and a clear profile field such as “Default hourly
rate”.

- [ ] **Step 3: Update all generated document callers.**

Quote completion, invoice payment notifications, invoice PDF download, invoice
detail, and public portal branding must resolve the profile by the quote/invoice
owner. Public portal lookup remains by token alone, then derives the owner
through the quote. Existing logo URLs and English document strings must remain
unchanged.

- [ ] **Step 4: Rewrite profile tests safely.**

Create an isolated test user and profile, clean those rows only, and remove the
old snapshot/restore logic for the shared `'company'` row. Test profile
isolation, hourly-rate validation, logo behavior, and admin view-as audit.

```bash
npx vitest run tests/integration/company-api.test.ts tests/integration/profile-api.test.ts
git add src/lib/companyProfile.ts src/app/api/company src/app/api/profile src/app/profile src/lib/invoicePdf.ts src/lib/email.ts src/app/api/quotes/[id]/complete src/app/api/invoices/[id] src/app/invoices/[id] src/app/portal/[token] tests/integration/company-api.test.ts tests/integration/profile-api.test.ts
git commit -m "feat(profile): make billing profiles and hourly rates user-owned"
```

---

### Task 6: Enforce owner scope on clients and quotes

**Files:**

- Modify: `src/lib/clients.ts`, `src/app/clients/page.tsx`
- Modify: `src/app/api/clients/route.ts`, `src/app/api/clients/[id]/route.ts`
- Modify: `src/app/api/quotes/route.ts`
- Modify: `src/app/api/quotes/[id]/route.ts`
- Modify: `src/app/api/quotes/[id]/booking/route.ts`
- Modify: `src/app/api/quotes/[id]/booking/round/route.ts`
- Modify: `src/app/api/quotes/photos/route.ts`
- Modify: `src/app/api/quotes/[id]/complete/route.ts`
- Modify: `src/app/quotes/page.tsx`, `src/app/quotes/new/page.tsx`,
  `src/app/quotes/[draftId]/page.tsx`
- Tests: existing client/quote/booking/photo/complete integration tests,
  `tests/integration/user-isolation.test.ts`

- [ ] **Step 1: Replace repeated session checks with effective scope.**

Every list/get/update/delete route must call `requireUserScope()`. Scope
`Client` by `userId`, `Quote` by `createdById`, and child lookups through a
scoped parent. An ID belonging to another owner returns the same 404 as an
unknown ID. Quote POST must scope the existing-draft lookup by
`{ draftId, createdById: scope.ownerUserId }`, upsert clients by
`{ userId, email }`, set `createdById` to `scope.ownerUserId`, and never trust a
client-provided owner.

- [ ] **Step 2: Preserve booking/portal boundaries.**

Authenticated booking/photo/complete routes scope through the quote owner and
write audit rows for view-as mutations. Public portal response routes continue
to resolve by `publicToken` alone and do not use a staff session. Public upload
routes remain public so the portal can render photos/logos.

- [ ] **Step 3: Apply feature checks.**

`/clients` and `/api/clients` require `clients_crm`; quote creation remains
usable when that flag is off because quote data still needs a client relation.
Quote completion requires `invoices` because it creates an invoice. Quotes
themselves are always enabled.

Update client deletion handling so a client with an invoice or any timesheet
entry returns a clear 409 response and is not deleted through a raw
foreign-key error. An invoiced timesheet entry remains permanently linked to
its invoice; deleting a timesheet invoice is prohibited in Task 7.

- [ ] **Step 4: Add isolation tests.**

Seed two users with same-email clients, quotes, and distinct clients. Assert
GET/list/get/update/delete paths cannot cross owners, same-email quote sync
creates separate clients, and an admin view-as can edit each target with audit
metadata. Run the existing affected tests plus:

```bash
npx vitest run tests/integration/clients-api.test.ts tests/integration/quotes-api.test.ts tests/integration/quotes-get-api.test.ts tests/integration/quotes-delete-api.test.ts tests/integration/booking-round-api.test.ts tests/integration/photos-api.test.ts tests/integration/user-isolation.test.ts
git add src/lib/clients.ts src/app/clients src/app/api/clients src/app/api/quotes src/app/quotes tests/integration
git commit -m "feat(isolation): scope clients and quotes by effective user"
```

---

### Task 7: Refactor the unified invoice flow for both sources

**Files:**

- Modify: `src/app/api/invoices/route.ts`
- Modify: `src/app/api/invoices/[id]/route.ts`
- Modify: `src/app/api/invoices/[id]/pdf/route.ts`
- Modify: `src/app/invoices/page.tsx`, `src/app/invoices/[id]/page.tsx`
- Modify: `src/components/InvoiceListClient.tsx`,
  `src/components/DeleteInvoiceButton.tsx`, `src/components/MarkPaidButton.tsx`
- Modify: `src/app/api/quotes/[id]/complete/route.ts`
- Modify: `src/lib/invoicePdf.ts`, `src/lib/email.ts`
- Tests: `tests/integration/invoices-api.test.ts`,
  `tests/integration/quotes-complete-api.test.ts`,
  `tests/unit/invoicePdf.test.ts`

- [ ] **Step 1: Update quote completion.**

Within the existing transaction, create the invoice with `source: 'quote'`,
`userId: quote.createdById`, `clientId: quote.clientId`, and a frozen
`serviceAddress`. Resolve the company profile for that owner. Keep the current
one-invoice-per-quote and email/PDF failure handling.

- [ ] **Step 2: Scope invoice APIs and normalize responses.**

All invoice reads/writes use `userId: scope.ownerUserId`; view-as writes audit.
List/detail responses include `source`, client, optional quote, and line items.
Payment email data must come from `invoice.client` and source-specific lines,
not assume `invoice.quote` is non-null. A timesheet invoice delete returns 409
with an English message; quote invoice deletion keeps the current behavior.

- [ ] **Step 3: Make PDF/email rendering source-neutral.**

Refactor `buildInvoicePdf` so `quoteNumber` is optional and the header uses
“Invoice #…” plus “Quote #…” only when present. Pass normalized line items for
quote items or invoice line items. Preserve PDFKit external-package config and
logo file handling. Update payment receipts and invoice emails to render both
sources.

- [ ] **Step 4: Update invoice pages/components.**

Keep `dynamic = 'force-dynamic'`, add authenticated scope checks, and render
client/source/line items for both invoice types. Hide invoice navigation and
return 403/redirect when the effective owner’s `invoices` flag is disabled.

- [ ] **Step 5: Test and commit.**

Cover quote invoice backfill/creation, user isolation, nullable quote detail,
timesheet-invoice deletion guard, payment status, PDF output, and both email
line shapes.

```bash
npx vitest run tests/integration/invoices-api.test.ts tests/integration/quotes-complete-api.test.ts tests/unit/invoicePdf.test.ts
git add src/app/api/invoices src/app/invoices src/components/Invoice* src/components/DeleteInvoiceButton.tsx src/components/MarkPaidButton.tsx src/app/api/quotes/[id]/complete src/lib/invoicePdf.ts src/lib/email.ts tests/integration tests/unit/invoicePdf.test.ts
git commit -m "feat(invoices): unify quote and timesheet invoice sources"
```

---

### Task 8: Timesheet server APIs and transactional invoice generation

**Files:**

- Create: `src/lib/timesheetMath.ts`
- Create: `src/app/api/timesheet/route.ts`
- Create: `src/app/api/timesheet/[id]/route.ts`
- Create: `src/app/api/timesheet/invoice/route.ts`
- Modify: `src/middleware.ts`
- Test: `tests/integration/timesheet-api.test.ts`,
  `tests/unit/timesheetMath.test.ts`

- [ ] **Step 1: Implement Decimal-safe calculation helpers.**

Validate `startedAt < endedAt`, calculate persisted whole-minute duration,
calculate hours × each entry’s snapshot rate, calculate product quantity ×
unit price, and calculate subtotal/tax/total using `Prisma.Decimal` or integer
cents. Reject negative rates, quantities, prices, and invalid tax rates.

- [ ] **Step 2: Implement list/create/update/delete entries.**

`GET /api/timesheet` accepts client/date-range filters and returns only open or
invoiced entries owned by the effective user. `POST` requires a client owned by
that user, snapshots `User.hourlyRate`, validates products, and creates the
entry/products together. `PATCH` and `DELETE` allow only `open` entries. Any
view-as mutation writes audit metadata. Require the `timesheet` flag for all
these routes.

- [ ] **Step 3: Implement manual invoice generation.**

`POST /api/timesheet/invoice` accepts one client, selected entry IDs or a date
range, optional tax rate (default 5% to match quote defaults), and optional
service address. Resolve and validate all entries as the same effective owner,
same client, and `open` status. In a serializable Prisma transaction, recheck
the set, create one `Invoice(source: timesheet, userId, clientId)` plus one
`InvoiceLineItem` per hour/product snapshot, then update all selected entries to
`invoiced` with `invoiceId`. If the update count differs, abort with 409; never
partially mark entries.

- [ ] **Step 4: Send and expose the generated invoice.**

After commit, resolve the owner’s company profile, build a source-neutral PDF,
and send the existing invoice email; email/PDF failures must not roll back the
committed invoice. Return the invoice and entry IDs. The next invoice attempt
must reject every already-invoiced entry.

- [ ] **Step 5: Test concurrency and boundaries.**

Test owner/client/date filters, hourly-rate snapshot after profile changes,
product totals, open-only editing, mixed-user/mixed-client selection rejection,
repeat generation rejection, and two concurrent generation requests where only
one succeeds. Run:

```bash
npx vitest run tests/integration/timesheet-api.test.ts tests/unit/timesheetMath.test.ts
git add src/lib/timesheetMath.ts src/app/api/timesheet src/middleware.ts tests/integration/timesheet-api.test.ts tests/unit/timesheetMath.test.ts
git commit -m "feat(timesheet): add owned entries and transactional invoice generation"
```

---

### Task 9: Timesheet/profile UI and navigation

**Files:**

- Create: `src/app/timesheet/page.tsx`
- Create: `src/app/timesheet/timesheet.module.css`
- Create: `src/components/TimesheetClient.tsx`
- Modify: `src/app/profile/page.tsx`, `src/app/profile/profile.module.css`
- Modify: `src/components/Header.tsx`, `src/components/Header.module.css`
- Modify: `src/components/InvoiceListClient.tsx`
- Test: `tests/unit/TimesheetClient.test.tsx`, relevant Header/profile tests

- [ ] **Step 1: Build the timesheet experience.**

Provide client/date filters, entry form with start/end times, product rows,
visible hourly-rate snapshot, edit/delete for open entries, and status badges.
Add selection checkboxes and a “Generate invoice” action that submits selected
IDs (or an explicit date range) and refreshes the unified invoice list. Show
English validation, 403 feature-disabled, and conflict messages.

- [ ] **Step 2: Add profile hourly-rate control.**

Show and save the user’s default hourly rate in `/profile`. Explain that new
entries snapshot the value and existing entries do not change when the default
changes. Keep company branding and personal notification/password sections
working.

- [ ] **Step 3: Make feature-aware navigation safe.**

Use `/api/view-context` to hide `Invoices`, `Timesheet`, and `Clients` links
according to effective flags while always showing `Quotes`. Do not rely on
hidden links for authorization; pages/APIs enforce flags server-side. On a
view-as switch, refresh context and local quote queries.

- [ ] **Step 4: Test UI behavior and commit.**

Cover product add/remove, duration/total display, selection and generation
request shape, disabled navigation, status display, and rate snapshot copy.

```bash
npx vitest run tests/unit/TimesheetClient.test.tsx
git add src/app/timesheet src/app/profile src/components/Header* src/components/InvoiceListClient.tsx tests/unit/TimesheetClient.test.tsx
git commit -m "feat(ui): add timesheet workspace and feature-aware navigation"
```

---

### Task 10: Complete authenticated-route/page audit and test fixtures

**Files:**

- Modify: every authenticated route under `src/app/api/clients`, `quotes`,
  `invoices`, `company`, `profile`, and the new `timesheet`/`admin` routes
- Modify: `src/app/clients/page.tsx`, invoice pages, profile page,
  `src/app/quotes/*`, timesheet page
- Modify: `prisma/seed.ts`, `CLAUDE.md`
- Modify: all affected `tests/integration/*.test.ts` fixtures
- Create: `tests/integration/per-user-isolation.test.ts`
- Create: `tests/e2e/per-user-isolation-timesheet.spec.ts`

- [ ] **Step 1: Search for unscoped access.**

Run searches for every `getServerSession`, `prisma.client`, `prisma.quote`,
`prisma.invoice`, `getCompanyProfile`, `findUnique({ where: { id` and mutation
in authenticated code. Each must either use `requireUserScope` and owner
filters or be explicitly documented as a public portal/token lookup.

- [ ] **Step 2: Update seed behavior.**

Keep `admin@tiptoptreesltd.com` as the existing admin with `status: active`,
`hourlyRate: 0`, a per-user `CompanyProfile`, and all initial optional flags
enabled. Make the seed idempotent and ensure it does not create duplicate
profiles/flags.

- [ ] **Step 3: Update integration fixtures and cleanup.**

Add `status`/`hourlyRate`, `Client.userId`, `Invoice.userId/clientId/source`,
and profile ownership to every direct Prisma fixture. Delete dependent rows in
safe order: invoice line items/products/timesheet entries, invoices, quotes,
clients/profiles/flags, then test users. Never delete production admin/profile
rows. Keep portal tests sessionless and verify their token behavior unchanged.

- [ ] **Step 4: Write the cross-surface isolation test.**

Create two users and same-email clients; create quotes, quote invoices,
timesheet entries, profiles, and feature flags for each. With each session,
assert lists/details/mutations return only that owner’s rows. As admin, view as
each target, edit one client/quote/timesheet/profile, and assert corresponding
`AuditLog` rows identify the admin actor and target user. Assert a disabled
feature returns 403 even while an admin views that user.

- [ ] **Step 5: Add the E2E scenario.**

Using real production server/auth flows, create or seed two users, verify
navigation hides disabled features, create an entry with a changed hourly-rate
default, generate one invoice, and verify the same entry cannot be selected
again. Verify admin view-as changes the visible data and exits cleanly.

- [ ] **Step 6: Update project guidance.**

Revise stale `CLAUDE.md` statements that say “no RBAC,” all users see all data,
`Client.email` is globally unique, and `CompanyProfile` is fixed-id. Preserve
the offline-first and upload warnings, and document view-as/audit and
per-user-profile test cleanup.

- [ ] **Step 7: Run and commit the complete fixture/audit change.**

```bash
npx vitest run tests/integration/per-user-isolation.test.ts
npm test
npm run lint
git add prisma/seed.ts CLAUDE.md src tests
git commit -m "test: verify per-user isolation across staff and admin view-as"
```

---

## Final verification checklist

- [ ] `npx prisma validate` and `npm run db:generate` succeed.
- [ ] Migration applied with `npx prisma migrate deploy`; no null ownership
  fields, duplicate per-user client emails, or orphaned invoice ownership.
- [ ] `npm test` passes with real Postgres.
- [ ] `npm run lint` passes.
- [ ] `npm run build` succeeds; inspect output for dynamic authenticated pages
  and confirm `pdfkit` remains externalized.
- [ ] `npm run test:e2e` passes against a fresh production server; stop any
  stale port-3000 server first as required by `CLAUDE.md`.
- [ ] Manual smoke test: sign in as two active users and confirm each sees only
  their clients/quotes/invoices/timesheets; confirm inactive/blocked login
  messages; confirm admin creates a user, enables flags, views as that user,
  edits data, sees the audit trail, and clears view-as.
- [ ] Manual smoke test: public quote portal still loads without a session,
  shows the correct per-owner branding/logo, accepts approval/booking, and
  quote photos/logo continue to load through route handlers.
- [ ] Confirm no code or migration introduced `Tenant`/`tenantId`; record the
  future integration point in `src/lib/userScope.ts` for the approved SaaS
  foundation plan.

---

## Post-rollout addendum (2026-09-04)

The following two follow-up features were requested after the user-isolation
rollout and are already being implemented in parallel by Claude Code (API) and
Lumen (UI). They are recorded here for plan continuity; no additional task
checklist is introduced.

### 1. Manual client creation from Timesheet

Timesheet users can create a client directly from the Timesheet workflow via
`POST /api/clients`. `GET /api/timesheet/clients` returns every client owned by
the effective user, without the existing “confirmed quote” filter, and is
gated by the `timesheet` feature flag. The existing owner/view-as and audit
rules continue to apply.

### 2. Per-user service catalog

`ServiceCatalogItem` now has a required `userId` owner; migration
`20260904150000_add_service_catalog_owner` has already been applied. The new
`/services` page and `GET/POST /api/services` plus
`GET/PATCH/DELETE /api/services/[id]` provide per-user CRUD. The Timesheet
product form uses the catalog as a fill-in shortcut, while retaining the
captured product name, quantity, and unit price as immutable invoice snapshots.
The catalog is user-owned now and can later receive `tenantId` when the SaaS
Tenant model is introduced.
