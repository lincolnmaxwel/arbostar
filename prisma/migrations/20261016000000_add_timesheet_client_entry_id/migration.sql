-- Idempotency key for timesheet entries logged offline and synced later.
ALTER TABLE "TimesheetEntry" ADD COLUMN "clientEntryId" TEXT;
CREATE UNIQUE INDEX "TimesheetEntry_userId_clientEntryId_key" ON "TimesheetEntry"("userId", "clientEntryId");
