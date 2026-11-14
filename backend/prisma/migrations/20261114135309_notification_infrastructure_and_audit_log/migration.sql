-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('RU', 'KY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('ADMIN', 'USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "toUserId" UUID,
    "appointmentId" UUID,
    "locale" "Locale" NOT NULL DEFAULT 'RU',
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    "lockedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" "AuditActor" NOT NULL,
    "actorId" UUID,
    "companyId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "name" TEXT NOT NULL,
    "beatAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_dedupeKey_key" ON "OutboxMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_scheduledFor_idx" ON "OutboxMessage"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "OutboxMessage_companyId_createdAt_idx" ON "OutboxMessage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_readAt_createdAt_idx" ON "InAppNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotification_companyId_userId_createdAt_idx" ON "InAppNotification"("companyId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_createdAt_idx" ON "AuditLog"("actorType", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_maxAttempts_check" CHECK ("maxAttempts" >= 1);
