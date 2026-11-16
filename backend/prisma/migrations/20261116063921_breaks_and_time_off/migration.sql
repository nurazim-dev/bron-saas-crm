-- CreateEnum
CREATE TYPE "TimeOffKind" AS ENUM ('VACATION', 'SICK_LEAVE', 'OTHER');

-- AlterTable
ALTER TABLE "WorkingHours" ADD COLUMN     "breakEnd" TEXT,
ADD COLUMN     "breakStart" TEXT;

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "kind" "TimeOffKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeOff_userId_startAt_endAt_idx" ON "TimeOff"("userId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "TimeOff_companyId_startAt_endAt_idx" ON "TimeOff"("companyId", "startAt", "endAt");

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints
ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_break_valid" CHECK (
  ("breakStart" IS NULL AND "breakEnd" IS NULL) OR
  ("breakStart" IS NOT NULL AND "breakEnd" IS NOT NULL AND "breakStart" < "breakEnd" AND "breakStart" >= "startTime" AND "breakEnd" <= "endTime")
);

ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_end_after_start" CHECK ("endAt" > "startAt");
