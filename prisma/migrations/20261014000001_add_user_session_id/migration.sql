-- Single active session per user: id of the most recent sign-in.
ALTER TABLE "User" ADD COLUMN "sessionId" TEXT;
