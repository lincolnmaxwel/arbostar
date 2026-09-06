-- User.defaultServiceName drives new timesheet entries; TimesheetEntry.
-- serviceName snapshots it at creation (same rule as hourlyRate). Both have
-- defaults, so no backfill is needed.
ALTER TABLE "TimesheetEntry" ADD COLUMN     "serviceName" TEXT NOT NULL DEFAULT 'Labor';

ALTER TABLE "User" ADD COLUMN     "defaultServiceName" TEXT NOT NULL DEFAULT 'Labor';