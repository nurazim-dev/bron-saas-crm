CREATE TABLE "AuthSession" (
 "id" UUID PRIMARY KEY, "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "companyId" UUID NOT NULL, "refreshHash" CHAR(64) NOT NULL UNIQUE, "userAgent" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL, "lastUsedAt" TIMESTAMPTZ(3) NOT NULL,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "revokedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "AuthSession_companyId_userId_revokedAt_idx" ON "AuthSession"("companyId", "userId", "revokedAt");
