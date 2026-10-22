-- First-login product tour: null = not seen yet. Every account that exists
-- today is marked as done so only accounts created from now on get the tour.
ALTER TABLE "User" ADD COLUMN "tourCompletedAt" TIMESTAMP(3);
UPDATE "User" SET "tourCompletedAt" = NOW();
