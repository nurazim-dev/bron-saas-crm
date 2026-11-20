-- Phase 6 Business Features: EN locale, company public profile, branding & custom domain
ALTER TYPE "Locale" ADD VALUE IF NOT EXISTS 'EN';

ALTER TABLE "Company"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "brandColor" TEXT,
  ADD COLUMN "customDomain" TEXT,
  ADD COLUMN "instagramUrl" TEXT;

CREATE UNIQUE INDEX "Company_customDomain_key" ON "Company"("customDomain");

ALTER TABLE "Company"
  ADD CONSTRAINT "Company_brandColor_hex_check" CHECK (
    "brandColor" IS NULL OR "brandColor" ~ '^#[0-9a-fA-F]{6}$'
  ),
  ADD CONSTRAINT "Company_customDomain_format_check" CHECK (
    "customDomain" IS NULL OR "customDomain" ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  );
