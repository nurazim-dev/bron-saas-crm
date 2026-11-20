-- Phase 24: Terms acceptance columns on User

ALTER TABLE "User"
  ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ(3),
  ADD COLUMN "termsVersion" TEXT;
