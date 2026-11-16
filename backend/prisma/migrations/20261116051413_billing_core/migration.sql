-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'LOCKED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MBANK', 'OPTIMA', 'DEMIR', 'BAKAI', 'ELCART', 'CASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('CLAIM', 'ADMIN_MANUAL');

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KGS',
    "maxStaff" INTEGER NOT NULL,
    "maxRemindersPerMonth" INTEGER,
    "featureAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "featureAutoReminders" BOOLEAN NOT NULL DEFAULT false,
    "featurePrepayment" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "isTrial" BOOLEAN NOT NULL DEFAULT true,
    "periodStartsAt" TIMESTAMPTZ(3) NOT NULL,
    "periodEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KGS',
    "months" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "comment" TEXT,
    "claimedByUserId" UUID,
    "reviewedByAdminId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,
    "periodStart" TIMESTAMPTZ(3),
    "periodEnd" TIMESTAMPTZ(3),
    "source" "PaymentSource" NOT NULL DEFAULT 'CLAIM',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedByAdminId" UUID,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_companyId_key" ON "Subscription"("companyId");

-- CreateIndex
CREATE INDEX "Subscription_status_periodEndsAt_idx" ON "Subscription"("status", "periodEndsAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_companyId_status_createdAt_idx" ON "SubscriptionPayment"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_status_createdAt_idx" ON "SubscriptionPayment"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (§4.4 / BR-19)
ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_priceMonthly_non_negative" CHECK ("priceMonthly" >= 0),
  ADD CONSTRAINT "Plan_maxStaff_min_one" CHECK ("maxStaff" >= 1);

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_period_order" CHECK ("periodEndsAt" > "periodStartsAt");

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_months_valid" CHECK ("months" IN (1, 3, 6, 12)),
  ADD CONSTRAINT "SubscriptionPayment_amount_non_negative" CHECK ("amount" >= 0);

-- At most one PENDING claim per company (BR-19)
CREATE UNIQUE INDEX "SubscriptionPayment_one_pending_per_company"
  ON "SubscriptionPayment" ("companyId")
  WHERE "status" = 'PENDING'::"PaymentStatus";

-- Reference Plans (§4.4)
INSERT INTO "Plan" (
  "id", "code", "name", "priceMonthly", "currency", "maxStaff", "maxRemindersPerMonth",
  "featureAnalytics", "featureAutoReminders", "featurePrepayment",
  "isActive", "isPublic", "sortOrder", "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid(), 'START', 'Старт', 990.00, 'KGS', 2, 0, false, false, false, true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BUSINESS', 'Бизнес', 1990.00, 'KGS', 7, 1000, true, true, true, true, true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PRO', 'Про', 3990.00, 'KGS', 30, 5000, true, true, true, true, true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Default PlatformSetting rows (§4.4)
INSERT INTO "PlatformSetting" ("key", "value", "updatedAt")
VALUES
  ('trialDays', '14'::jsonb, CURRENT_TIMESTAMP),
  ('graceDays', '3'::jsonb, CURRENT_TIMESTAMP),
  ('trialPlanCode', '"BUSINESS"'::jsonb, CURRENT_TIMESTAMP),
  ('registrationOpen', 'true'::jsonb, CURRENT_TIMESTAMP),
  ('billingPaymentInstructions', '""'::jsonb, CURRENT_TIMESTAMP),
  ('supportPhone', '""'::jsonb, CURRENT_TIMESTAMP),
  ('supportWhatsapp', '""'::jsonb, CURRENT_TIMESTAMP),
  ('supportEmail', '""'::jsonb, CURRENT_TIMESTAMP),
  ('announcementEnabled', 'false'::jsonb, CURRENT_TIMESTAMP),
  ('announcementText', '""'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Backfill fresh TRIAL subscription for any existing company without a subscription (§4.4)
INSERT INTO "Subscription" (
  "id", "companyId", "planId", "isTrial", "periodStartsAt", "periodEndsAt", "status", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  c."id",
  p."id",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '14 days',
  'TRIAL'::"SubscriptionStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (SELECT "id" FROM "Plan" WHERE "code" = 'BUSINESS' LIMIT 1) p
WHERE NOT EXISTS (
  SELECT 1 FROM "Subscription" s WHERE s."companyId" = c."id"
)
ON CONFLICT ("companyId") DO NOTHING;
