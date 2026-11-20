-- Phase 3 (CRM): client tags, tag assignments, and client merge lineage

ALTER TABLE "Client"
  ADD COLUMN "mergedIntoClientId" UUID,
  ADD COLUMN "mergedAt" TIMESTAMPTZ(3);

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_merged_not_self_check"
  CHECK ("mergedIntoClientId" IS NULL OR "mergedIntoClientId" <> "id");

CREATE UNIQUE INDEX "Client_id_companyId_key" ON "Client"("id", "companyId");
CREATE INDEX "Client_companyId_mergedAt_idx" ON "Client"("companyId", "mergedAt");

CREATE TABLE "ClientTag" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#0f766e',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientTag_id_companyId_key" ON "ClientTag"("id", "companyId");
CREATE INDEX "ClientTag_companyId_idx" ON "ClientTag"("companyId");
CREATE UNIQUE INDEX "ClientTag_companyId_lower_name_key" ON "ClientTag"("companyId", lower("name"));

ALTER TABLE "ClientTag"
  ADD CONSTRAINT "ClientTag_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientTagAssignment" (
  "clientId" UUID NOT NULL,
  "tagId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientTagAssignment_pkey" PRIMARY KEY ("clientId", "tagId")
);

CREATE INDEX "ClientTagAssignment_companyId_tagId_idx" ON "ClientTagAssignment"("companyId", "tagId");
CREATE INDEX "ClientTagAssignment_companyId_clientId_idx" ON "ClientTagAssignment"("companyId", "clientId");

ALTER TABLE "ClientTagAssignment"
  ADD CONSTRAINT "ClientTagAssignment_clientId_companyId_fkey"
  FOREIGN KEY ("clientId", "companyId") REFERENCES "Client"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientTagAssignment"
  ADD CONSTRAINT "ClientTagAssignment_tagId_companyId_fkey"
  FOREIGN KEY ("tagId", "companyId") REFERENCES "ClientTag"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
