-- Description is required on every timesheet entry. Confirmed safe: no
-- existing row has a NULL description (the column was added nullable in
-- 20260905010000 and every current row was written with one).
ALTER TABLE "TimesheetEntry" ALTER COLUMN "description" SET NOT NULL;