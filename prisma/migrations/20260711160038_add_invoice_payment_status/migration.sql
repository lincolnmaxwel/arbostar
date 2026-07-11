-- CreateEnum
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('pending', 'paid');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'pending';
