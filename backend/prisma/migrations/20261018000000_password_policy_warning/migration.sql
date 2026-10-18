-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3);


-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

