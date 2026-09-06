-- Service catalog items are billed per unit/package (quantity) or per hour.
-- Both new columns have safe defaults/are nullable, so no backfill is needed.
CREATE TYPE "ServiceBillingType" AS ENUM ('quantity', 'hourly');

ALTER TABLE "ServiceCatalogItem" ADD COLUMN     "billingType" "ServiceBillingType" NOT NULL DEFAULT 'quantity',
ADD COLUMN     "unit" TEXT;