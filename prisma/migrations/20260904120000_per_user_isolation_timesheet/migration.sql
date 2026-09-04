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
CREATE INDEX "Quote_createdById_idx" ON "Quote" ("createdById");
CREATE INDEX "Client_userId_idx" ON "Client" ("userId");
CREATE INDEX "Invoice_userId_idx" ON "Invoice" ("userId");
CREATE INDEX "Invoice_clientId_idx" ON "Invoice" ("clientId");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog" ("actorId");
CREATE INDEX "AuditLog_targetUserId_idx" ON "AuditLog" ("targetUserId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");