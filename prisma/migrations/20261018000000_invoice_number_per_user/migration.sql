-- Invoice numbers become sequential per user instead of global.
DROP INDEX IF EXISTS "Invoice_number_key";
CREATE UNIQUE INDEX "Invoice_userId_number_key" ON "Invoice"("userId", "number");
