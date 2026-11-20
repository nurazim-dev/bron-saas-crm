-- Phase 11: Shrink BusinessType enum to (BARBERSHOP, BEAUTY_SALON)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Company"
    WHERE "businessType"::text NOT IN ('BARBERSHOP', 'BEAUTY_SALON')
  ) THEN
    RAISE EXCEPTION 'Cannot shrink BusinessType: rows with removed values (AUTO_SERVICE, OTHER) exist in Company';
  END IF;
END
$$;

CREATE TYPE "BusinessType_new" AS ENUM ('BARBERSHOP', 'BEAUTY_SALON');

ALTER TABLE "Company" ALTER COLUMN "businessType" DROP DEFAULT;
ALTER TABLE "Company"
  ALTER COLUMN "businessType" TYPE "BusinessType_new"
  USING ("businessType"::text::"BusinessType_new");

DROP TYPE "BusinessType";
ALTER TYPE "BusinessType_new" RENAME TO "BusinessType";

ALTER TABLE "Company" ALTER COLUMN "businessType" SET DEFAULT 'BARBERSHOP'::"BusinessType";
