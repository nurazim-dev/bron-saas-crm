-- CreateEnum
CREATE TYPE "CancelActor" AS ENUM ('CLIENT', 'STAFF');

-- AlterTable: Company policy fields
ALTER TABLE "Company"
  ADD COLUMN "allowClientReschedule" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "clientCancelMinHours" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_clientCancelMinHours_check"
  CHECK ("clientCancelMinHours" >= 0 AND "clientCancelMinHours" <= 168);

-- AlterTable: Appointment self-service columns (manageToken nullable first for safe backfill)
ALTER TABLE "Appointment"
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledBy" "CancelActor",
  ADD COLUMN "manageToken" TEXT,
  ADD COLUMN "rescheduledCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill unique manageToken for all existing appointments
UPDATE "Appointment"
SET "manageToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE "manageToken" IS NULL;

-- Enforce NOT NULL and UNIQUE
ALTER TABLE "Appointment" ALTER COLUMN "manageToken" SET NOT NULL;
CREATE UNIQUE INDEX "Appointment_manageToken_key" ON "Appointment"("manageToken");
