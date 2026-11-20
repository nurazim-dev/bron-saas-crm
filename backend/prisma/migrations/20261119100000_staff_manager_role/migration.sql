ALTER TYPE "Role" ADD VALUE 'MANAGER';

ALTER TABLE "User" ADD CONSTRAINT "User_bookable_role_check"
  CHECK (NOT "isBookable" OR "role" IN ('OWNER', 'MASTER'));
