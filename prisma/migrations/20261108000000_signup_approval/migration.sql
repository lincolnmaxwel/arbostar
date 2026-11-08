-- Invite-only sign-up: contact details, email-verified marker and a deny list.
ALTER TABLE "PendingSignup" ADD COLUMN "phone" TEXT;
ALTER TABLE "PendingSignup" ADD COLUMN "referral" TEXT;
ALTER TABLE "PendingSignup" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "BlockedEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "referral" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedById" TEXT,

    CONSTRAINT "BlockedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockedEmail_email_key" ON "BlockedEmail"("email");
