ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3), ADD COLUMN "emailVerifyHash" CHAR(64), ADD COLUMN "emailVerifyExpiresAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "User_emailVerifyHash_key" ON "User"("emailVerifyHash");
