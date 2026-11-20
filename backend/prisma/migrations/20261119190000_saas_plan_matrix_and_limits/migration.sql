-- Additive SaaS plan feature matrix & resource limits (Phase 5)
ALTER TABLE "Plan"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "maxServices" INTEGER,
  ADD COLUMN "maxAppointmentsPerMonth" INTEGER,
  ADD COLUMN "featureCrmAdvanced" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "featureManualPayments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "featureMultiCompany" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "featureCustomBranding" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isLegacy" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_maxServices_positive" CHECK ("maxServices" IS NULL OR "maxServices" > 0),
  ADD CONSTRAINT "Plan_maxAppointmentsPerMonth_positive" CHECK (
    "maxAppointmentsPerMonth" IS NULL OR "maxAppointmentsPerMonth" > 0
  );

-- Seed FREE public plan for solo masters (data-preserving baseline tier)
INSERT INTO "Plan" (
  "id", "code", "name", "description", "priceMonthly", "currency",
  "maxStaff", "maxServices", "maxAppointmentsPerMonth", "maxRemindersPerMonth",
  "featureAnalytics", "featureAutoReminders", "featurePrepayment",
  "featureCrmAdvanced", "featureManualPayments", "featureMultiCompany", "featureCustomBranding",
  "isActive", "isPublic", "isLegacy", "sortOrder", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid(),
  'FREE',
  'Бесплатный',
  'Для самостоятельного мастера: базовое расписание, онлайн-запись и список клиентов',
  0.00,
  'KGS',
  1,
  10,
  50,
  0,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  true,
  true,
  false,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "priceMonthly" = EXCLUDED."priceMonthly",
  "maxStaff" = EXCLUDED."maxStaff",
  "maxServices" = EXCLUDED."maxServices",
  "maxAppointmentsPerMonth" = EXCLUDED."maxAppointmentsPerMonth",
  "maxRemindersPerMonth" = EXCLUDED."maxRemindersPerMonth",
  "featureAnalytics" = EXCLUDED."featureAnalytics",
  "featureAutoReminders" = EXCLUDED."featureAutoReminders",
  "featurePrepayment" = EXCLUDED."featurePrepayment",
  "featureCrmAdvanced" = EXCLUDED."featureCrmAdvanced",
  "featureManualPayments" = EXCLUDED."featureManualPayments",
  "featureMultiCompany" = EXCLUDED."featureMultiCompany",
  "featureCustomBranding" = EXCLUDED."featureCustomBranding",
  "isActive" = true,
  "isPublic" = true,
  "isLegacy" = false,
  "sortOrder" = 0,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Preserve legacy START plan without losing existing companies' access
UPDATE "Plan"
SET
  "isLegacy" = true,
  "isPublic" = false,
  "isActive" = true,
  "description" = COALESCE(
    "description",
    'Архивный стартовый тариф (доступ сохранён для действующих компаний)'
  ),
  "featureCrmAdvanced" = true,
  "featureManualPayments" = true,
  "featureMultiCompany" = false,
  "featureCustomBranding" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'START';

-- Enrich BUSINESS and PRO descriptions and feature matrix flags
UPDATE "Plan"
SET
  "description" = COALESCE(
    "description",
    'Для салона или барбершопа: команда до 7 мастеров, аналитика, предоплата и ручные чеки'
  ),
  "maxServices" = NULL,
  "maxAppointmentsPerMonth" = NULL,
  "featureAnalytics" = true,
  "featureAutoReminders" = true,
  "featurePrepayment" = true,
  "featureCrmAdvanced" = true,
  "featureManualPayments" = true,
  "featureMultiCompany" = true,
  "featureCustomBranding" = false,
  "isPublic" = true,
  "isLegacy" = false,
  "sortOrder" = 2,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'BUSINESS';

UPDATE "Plan"
SET
  "description" = COALESCE(
    "description",
    'Для сети и крупных студий: до 30 мастеров, филиалы и расширенный брендинг'
  ),
  "maxServices" = NULL,
  "maxAppointmentsPerMonth" = NULL,
  "featureAnalytics" = true,
  "featureAutoReminders" = true,
  "featurePrepayment" = true,
  "featureCrmAdvanced" = true,
  "featureManualPayments" = true,
  "featureMultiCompany" = true,
  "featureCustomBranding" = true,
  "isPublic" = true,
  "isLegacy" = false,
  "sortOrder" = 3,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'PRO';
