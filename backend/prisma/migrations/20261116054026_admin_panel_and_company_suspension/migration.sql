-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "suspendedAt" TIMESTAMPTZ(3),
ADD COLUMN     "suspendedByAdminId" UUID,
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMPTZ(3),
    "lastTotpStep" INTEGER,
    "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationCode" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "targetUserId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ImpersonationCode_codeHash_key" ON "ImpersonationCode"("codeHash");

-- CreateIndex
CREATE INDEX "ImpersonationCode_adminId_createdAt_idx" ON "ImpersonationCode"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "ImpersonationCode_companyId_createdAt_idx" ON "ImpersonationCode"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImpersonationCode" ADD CONSTRAINT "ImpersonationCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationCode" ADD CONSTRAINT "ImpersonationCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
