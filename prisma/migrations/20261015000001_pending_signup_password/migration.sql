-- The password is now chosen at sign-up time and stored (bcrypt-hashed) on
-- the pending row, so confirming the email link creates the account without a
-- second form. Nullable only so rows created before this change still
-- migrate; new rows always set it.
ALTER TABLE "PendingSignup" ADD COLUMN "passwordHash" TEXT;