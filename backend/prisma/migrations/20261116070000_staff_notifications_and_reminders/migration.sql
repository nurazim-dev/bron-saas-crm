-- CreateEnum
CREATE TYPE "ReminderMode" AS ENUM ('OFF', 'MANUAL', 'AUTO');

-- AlterTable Company
ALTER TABLE "Company"
  ADD COLUMN "defaultLocale" "Locale" NOT NULL DEFAULT 'RU',
  ADD COLUMN "reminderMode" "ReminderMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "remind24h" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "remind2h" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable User
ALTER TABLE "User"
  ADD COLUMN "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyTelegram" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "telegramChatId" TEXT,
  ADD COLUMN "telegramLinkCodeHash" TEXT,
  ADD COLUMN "telegramLinkCodeExpiresAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- AlterTable Appointment
ALTER TABLE "Appointment"
  ADD COLUMN "clientLocale" "Locale" NOT NULL DEFAULT 'RU',
  ADD COLUMN "manualReminderSentAt" TIMESTAMPTZ(3);
