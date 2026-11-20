-- AlterTable: add telegramChatId to Client for Telegram reminders & self-service bot
ALTER TABLE "Client" ADD COLUMN "telegramChatId" TEXT;

-- CreateIndex
CREATE INDEX "Client_telegramChatId_idx" ON "Client"("telegramChatId");
