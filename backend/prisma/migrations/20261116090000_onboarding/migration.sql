-- Phase 23: Onboarding columns on Company

ALTER TABLE "Company"
  ADD COLUMN "onboardingLinkSharedAt" TIMESTAMPTZ(3),
  ADD COLUMN "onboardingCompletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "onboardingDismissedAt" TIMESTAMPTZ(3);
