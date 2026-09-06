-- Additive nullable columns: no backfill needed. TimesheetEntry.description
-- carries free text about the work done in the period; InvoiceLineItem.notes
-- carries that text frozen into an invoice line (the existing `description`
-- column stays the line title).
ALTER TABLE "InvoiceLineItem" ADD COLUMN     "notes" TEXT;

ALTER TABLE "TimesheetEntry" ADD COLUMN     "description" TEXT;