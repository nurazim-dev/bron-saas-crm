-- Phase 21: Light Prepayment

ALTER TYPE "CancelActor" ADD VALUE IF NOT EXISTS 'SYSTEM';

CREATE TYPE "PrepaymentMode" AS ENUM ('FIXED', 'PERCENT');
CREATE TYPE "PrepaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RECEIVED', 'REFUNDED');

ALTER TABLE "Company"
  ADD COLUMN "paymentInstructions" TEXT,
  ADD COLUMN "prepaymentHoldMin" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_prepaymentHoldMin_chk"
  CHECK ("prepaymentHoldMin" >= 0 AND "prepaymentHoldMin" <= 1440);

ALTER TABLE "Service"
  ADD COLUMN "requiresPrepayment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "prepaymentMode" "PrepaymentMode",
  ADD COLUMN "prepaymentValue" DECIMAL(10,2);

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_prepayment_chk"
  CHECK (
    "requiresPrepayment" = false
    OR (
      "prepaymentMode" IS NOT NULL
      AND "prepaymentValue" IS NOT NULL
      AND "prepaymentValue" > 0
      AND ("prepaymentMode" <> 'PERCENT' OR "prepaymentValue" <= 100)
    )
  );

ALTER TABLE "Appointment"
  ADD COLUMN "prepaymentStatus" "PrepaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "prepaymentAmount" DECIMAL(10,2),
  ADD COLUMN "prepaymentHoldUntil" TIMESTAMPTZ(3),
  ADD COLUMN "prepaymentReceivedAt" TIMESTAMPTZ(3);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_prepaymentAmount_chk"
  CHECK ("prepaymentAmount" IS NULL OR "prepaymentAmount" >= 0);

CREATE INDEX "Appointment_companyId_prepaymentStatus_idx"
  ON "Appointment"("companyId", "prepaymentStatus");

CREATE INDEX "Appointment_status_prepaymentStatus_prepaymentHoldUntil_idx"
  ON "Appointment"("status", "prepaymentStatus", "prepaymentHoldUntil");
