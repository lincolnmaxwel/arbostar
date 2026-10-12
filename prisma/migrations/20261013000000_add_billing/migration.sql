-- Billing: Stripe subscription state + trial window on User, plus a small
-- key/value settings table (trial length is admin-editable).
ALTER TABLE "User"
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "subscriptionStatus" TEXT,
  ADD COLUMN "subscriptionPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "subscriptionCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- Everyone who exists at deploy time is grandfathered so nobody is locked out
-- by the rollout. Accounts created afterwards start with billingExempt = false
-- and a trial; an admin can flip the exemption per user.
UPDATE "User" SET "billingExempt" = true;

CREATE TABLE "AppSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
