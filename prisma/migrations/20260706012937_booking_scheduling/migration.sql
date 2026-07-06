-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('idle', 'proposed', 'rejected', 'confirmed');

-- CreateEnum
CREATE TYPE "DayWindow" AS ENUM ('morning', 'afternoon', 'fullday');

-- CreateEnum
CREATE TYPE "ScheduleRoundStatus" AS ENUM ('proposed', 'rejected', 'confirmed');

-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE 'scheduled';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "bookingStatus" "BookingStatus" NOT NULL DEFAULT 'idle',
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "scheduledWindow" "DayWindow";

-- CreateTable
CREATE TABLE "ScheduleRound" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" "ScheduleRoundStatus" NOT NULL DEFAULT 'proposed',
    "rejectionReason" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleOption" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "proposedDate" DATE NOT NULL,
    "window" "DayWindow" NOT NULL,
    "chosen" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScheduleOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRound_quoteId_roundNumber_key" ON "ScheduleRound"("quoteId", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleOption_roundId_proposedDate_window_key" ON "ScheduleOption"("roundId", "proposedDate", "window");

-- AddForeignKey
ALTER TABLE "ScheduleRound" ADD CONSTRAINT "ScheduleRound_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleOption" ADD CONSTRAINT "ScheduleOption_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "ScheduleRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
