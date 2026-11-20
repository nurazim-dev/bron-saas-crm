-- Core Booking Phase 2 (part 1):
-- 1. Extend AppointmentStatus enum (committed before EXCLUDE update in next migration)
-- 2. Master-specific price and duration overrides on MasterService
-- 3. ServicePackage & ServicePackageItem with composite tenant FKs
-- 4. Nullable packageId / packageName on Appointment

ALTER TYPE "AppointmentStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "AppointmentStatus" ADD VALUE 'IN_PROGRESS';

ALTER TABLE "MasterService"
  ADD COLUMN "customPrice" DECIMAL(10, 2),
  ADD COLUMN "customDurationMin" INTEGER;

ALTER TABLE "MasterService"
  ADD CONSTRAINT "MasterService_customPrice_non_negative_chk"
  CHECK ("customPrice" IS NULL OR "customPrice" >= 0),
  ADD CONSTRAINT "MasterService_customDurationMin_range_chk"
  CHECK ("customDurationMin" IS NULL OR "customDurationMin" BETWEEN 5 AND 720);

CREATE TABLE "ServicePackage" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(10, 2) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "deletedAt" TIMESTAMPTZ(3),

  CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServicePackage_price_non_negative_chk" CHECK ("price" >= 0)
);

CREATE UNIQUE INDEX "ServicePackage_id_companyId_key" ON "ServicePackage"("id", "companyId");
CREATE INDEX "ServicePackage_companyId_deletedAt_idx" ON "ServicePackage"("companyId", "deletedAt");

ALTER TABLE "ServicePackage"
  ADD CONSTRAINT "ServicePackage_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ServicePackageItem" (
  "packageId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "serviceId" UUID NOT NULL,
  "position" INTEGER NOT NULL,

  CONSTRAINT "ServicePackageItem_pkey" PRIMARY KEY ("packageId", "serviceId")
);

CREATE UNIQUE INDEX "ServicePackageItem_packageId_position_key" ON "ServicePackageItem"("packageId", "position");
CREATE INDEX "ServicePackageItem_companyId_serviceId_idx" ON "ServicePackageItem"("companyId", "serviceId");

ALTER TABLE "ServicePackageItem"
  ADD CONSTRAINT "ServicePackageItem_packageId_companyId_fkey"
  FOREIGN KEY ("packageId", "companyId") REFERENCES "ServicePackage"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServicePackageItem"
  ADD CONSTRAINT "ServicePackageItem_serviceId_companyId_fkey"
  FOREIGN KEY ("serviceId", "companyId") REFERENCES "Service"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD COLUMN "packageId" UUID,
  ADD COLUMN "packageName" TEXT;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_packageId_companyId_fkey"
  FOREIGN KEY ("packageId", "companyId") REFERENCES "ServicePackage"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
