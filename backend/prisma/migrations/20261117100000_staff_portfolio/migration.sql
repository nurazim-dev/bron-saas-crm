ALTER TABLE "User" ADD COLUMN "biography" TEXT NOT NULL DEFAULT '', ADD COLUMN "specialties" TEXT NOT NULL DEFAULT '', ADD COLUMN "experienceYears" INTEGER;
ALTER TABLE "User" ADD CONSTRAINT "User_experience_range" CHECK ("experienceYears" BETWEEN 0 AND 80);
CREATE UNIQUE INDEX "User_companyId_id_key" ON "User"("companyId", "id");
CREATE TABLE "StaffMedia" (
 "id" UUID PRIMARY KEY, "companyId" UUID NOT NULL, "userId" UUID NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('PHOTO','WORK','VIDEO')),
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','READY','REJECTED')),
 "position" INTEGER NOT NULL DEFAULT 0, "isCover" BOOLEAN NOT NULL DEFAULT false,
 "caption" TEXT NOT NULL DEFAULT '', "mime" TEXT NOT NULL DEFAULT '',
 "data" BYTEA, "poster" BYTEA, "size" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "StaffMedia_user_fkey" FOREIGN KEY ("companyId", "userId") REFERENCES "User"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "StaffMedia_size_check" CHECK ("size" >= 0 AND "size" <= 26214400)
);
CREATE INDEX "StaffMedia_companyId_userId_status_idx" ON "StaffMedia"("companyId", "userId", "status");
