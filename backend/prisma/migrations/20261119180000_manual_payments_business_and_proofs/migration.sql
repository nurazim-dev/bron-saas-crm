-- Phase 4 (Manual Payments): separate BusinessPayment ledger and private PaymentProof storage

CREATE TYPE "BusinessPaymentKind" AS ENUM ('PAYMENT', 'PREPAYMENT', 'REFUND');
CREATE TYPE "BusinessPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'VOIDED');
CREATE TYPE "PaymentProofScope" AS ENUM ('SUBSCRIPTION_PAYMENT', 'BUSINESS_PAYMENT');

CREATE UNIQUE INDEX "SubscriptionPayment_id_companyId_key" ON "SubscriptionPayment"("id", "companyId");

CREATE TABLE "BusinessPayment" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "appointmentId" UUID,
  "clientId" UUID,
  "kind" "BusinessPaymentKind" NOT NULL DEFAULT 'PAYMENT',
  "status" "BusinessPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KGS',
  "method" "PaymentMethod" NOT NULL,
  "providerCode" TEXT NOT NULL DEFAULT 'MANUAL',
  "reference" TEXT,
  "note" TEXT,
  "rejectReason" TEXT,
  "recordedByUserId" UUID,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(3),
  "paidAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessPayment_amount_positive_chk" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "BusinessPayment_id_companyId_key" ON "BusinessPayment"("id", "companyId");
CREATE INDEX "BusinessPayment_companyId_status_createdAt_idx" ON "BusinessPayment"("companyId", "status", "createdAt");
CREATE INDEX "BusinessPayment_companyId_paidAt_idx" ON "BusinessPayment"("companyId", "paidAt");
CREATE INDEX "BusinessPayment_companyId_appointmentId_idx" ON "BusinessPayment"("companyId", "appointmentId");
CREATE INDEX "BusinessPayment_companyId_clientId_idx" ON "BusinessPayment"("companyId", "clientId");

ALTER TABLE "BusinessPayment"
  ADD CONSTRAINT "BusinessPayment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessPayment"
  ADD CONSTRAINT "BusinessPayment_appointmentId_companyId_fkey"
  FOREIGN KEY ("appointmentId", "companyId") REFERENCES "Appointment"("id", "companyId") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BusinessPayment"
  ADD CONSTRAINT "BusinessPayment_clientId_companyId_fkey"
  FOREIGN KEY ("clientId", "companyId") REFERENCES "Client"("id", "companyId") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PaymentProof" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "scope" "PaymentProofScope" NOT NULL,
  "subscriptionPaymentId" UUID,
  "businessPaymentId" UUID,
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "uploadedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentProof_size_range_chk" CHECK ("size" > 0 AND "size" <= 5242880),
  CONSTRAINT "PaymentProof_single_target_chk" CHECK (
    (
      "scope" = 'SUBSCRIPTION_PAYMENT'::"PaymentProofScope"
      AND "subscriptionPaymentId" IS NOT NULL
      AND "businessPaymentId" IS NULL
    )
    OR
    (
      "scope" = 'BUSINESS_PAYMENT'::"PaymentProofScope"
      AND "businessPaymentId" IS NOT NULL
      AND "subscriptionPaymentId" IS NULL
    )
  )
);

CREATE INDEX "PaymentProof_companyId_subscriptionPaymentId_idx" ON "PaymentProof"("companyId", "subscriptionPaymentId");
CREATE INDEX "PaymentProof_companyId_businessPaymentId_idx" ON "PaymentProof"("companyId", "businessPaymentId");

ALTER TABLE "PaymentProof"
  ADD CONSTRAINT "PaymentProof_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentProof"
  ADD CONSTRAINT "PaymentProof_subscriptionPaymentId_companyId_fkey"
  FOREIGN KEY ("subscriptionPaymentId", "companyId") REFERENCES "SubscriptionPayment"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentProof"
  ADD CONSTRAINT "PaymentProof_businessPaymentId_companyId_fkey"
  FOREIGN KEY ("businessPaymentId", "companyId") REFERENCES "BusinessPayment"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
