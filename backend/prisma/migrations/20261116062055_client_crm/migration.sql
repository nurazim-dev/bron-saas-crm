-- Enable pg_trgm for fast client name/phone search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedAt" TIMESTAMPTZ(3),
    "locale" "Locale" NOT NULL DEFAULT 'RU',
    "anonymizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_companyId_isBlocked_idx" ON "Client"("companyId", "isBlocked");

-- CreateIndex
CREATE UNIQUE INDEX "Client_companyId_phone_key" ON "Client"("companyId", "phone");

-- CreateIndex (pg_trgm GIN indexes)
CREATE INDEX "Client_name_trgm_idx" ON "Client" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Client_phone_trgm_idx" ON "Client" USING gin ("phone" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add nullable columns first for safe backfill
ALTER TABLE "Appointment" ADD COLUMN "clientId" UUID;
ALTER TABLE "Appointment" ADD COLUMN "consentAcceptedAt" TIMESTAMPTZ(3);

-- Backfill Client from existing Appointments (one Client per (companyId, clientPhone), most recent name)
INSERT INTO "Client" ("id", "companyId", "name", "phone", "locale", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    src."companyId",
    src."clientName",
    src."clientPhone",
    'RU'::"Locale",
    src."firstSeenAt",
    NOW()
FROM (
    SELECT DISTINCT ON ("companyId", "clientPhone")
        "companyId",
        "clientPhone",
        "clientName",
        MIN("createdAt") OVER (PARTITION BY "companyId", "clientPhone") AS "firstSeenAt"
    FROM "Appointment"
    ORDER BY "companyId", "clientPhone", "createdAt" DESC, "id" DESC
) src
ON CONFLICT ("companyId", "phone") DO NOTHING;

-- Backfill Appointment.clientId
UPDATE "Appointment" a
SET "clientId" = c."id"
FROM "Client" c
WHERE c."companyId" = a."companyId" AND c."phone" = a."clientPhone";

-- Enforce NOT NULL, FK, and index
ALTER TABLE "Appointment" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Appointment_companyId_clientId_idx" ON "Appointment"("companyId", "clientId");
