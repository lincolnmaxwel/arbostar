-- ServiceCatalogItem is unowned and empty in every real deployment so far
-- (never wired into any API before this migration); adding a required
-- userId directly is safe, no backfill needed.
ALTER TABLE "ServiceCatalogItem" ADD COLUMN     "userId" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "ServiceCatalogItem_userId_idx" ON "ServiceCatalogItem"("userId");

ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
