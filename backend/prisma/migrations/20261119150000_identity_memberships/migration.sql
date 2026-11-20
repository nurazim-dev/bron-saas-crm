-- Foundation: shared login Identity for several company memberships (User rows).
-- Expand + backfill. Existing User ids, companyId, role and every relation are unchanged.

CREATE TABLE "Identity" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "credentialVersion" INTEGER NOT NULL DEFAULT 0,
    "lastCompanyId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Identity_email_key" ON "Identity"("email");

ALTER TABLE "User" ADD COLUMN "identityId" UUID;

-- Backfill: one identity per existing user with an email (including soft-deleted rows,
-- which kept the email reserved under the previous global unique index). The identity
-- id equals the original user id so the mapping is verifiable.
INSERT INTO "Identity" ("id", "email", "passwordHash", "credentialVersion", "lastCompanyId", "createdAt", "updatedAt")
SELECT "id", "email", "passwordHash", 0, "companyId", "createdAt", CURRENT_TIMESTAMP
FROM "User"
WHERE "email" IS NOT NULL;

UPDATE "User" SET "identityId" = "id" WHERE "email" IS NOT NULL;

-- Compatibility verification inside the migration transaction.
DO $$
DECLARE
  missing INTEGER;
  mismatched INTEGER;
BEGIN
  SELECT count(*) INTO missing FROM "User" WHERE ("email" IS NULL) <> ("identityId" IS NULL);
  SELECT count(*) INTO mismatched
    FROM "User" u JOIN "Identity" i ON i."id" = u."identityId"
    WHERE u."email" IS DISTINCT FROM i."email"
       OR u."passwordHash" IS DISTINCT FROM i."passwordHash";
  IF missing > 0 OR mismatched > 0 THEN
    RAISE EXCEPTION 'Identity backfill verification failed: missing=%, mismatched=%', missing, mismatched;
  END IF;
END $$;

ALTER TABLE "User" ADD CONSTRAINT "User_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One membership per identity per company; email is unique per company and, through
-- Identity.email, globally per person.
CREATE UNIQUE INDEX "User_identityId_companyId_key" ON "User"("identityId", "companyId");
CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");
DROP INDEX "User_email_key";

-- A login email always belongs to an identity; a membership without email has none.
ALTER TABLE "User" ADD CONSTRAINT "User_email_identity_check"
  CHECK (("email" IS NULL) = ("identityId" IS NULL));

-- Membership email must equal identity email (checked at commit, so the identity and
-- its memberships can be updated in any order within one transaction).
CREATE OR REPLACE FUNCTION "zapis_check_user_identity_email"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    IF NEW."identityId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Identity" i WHERE i."id" = NEW."identityId" AND i."email" = NEW."email"
    ) THEN
      RAISE EXCEPTION 'User email must match identity email' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM "User" u WHERE u."identityId" = NEW."id" AND u."email" IS DISTINCT FROM NEW."email"
    ) THEN
      RAISE EXCEPTION 'Identity email must match membership emails' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "User_identity_email_match"
  AFTER INSERT OR UPDATE OF "email", "identityId" ON "User"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "zapis_check_user_identity_email"();

CREATE CONSTRAINT TRIGGER "Identity_email_match"
  AFTER UPDATE OF "email" ON "Identity"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "zapis_check_user_identity_email"();
