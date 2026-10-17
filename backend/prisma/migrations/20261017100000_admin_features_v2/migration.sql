-- CreateEnum
CREATE TYPE "DeviceProvisionStatus" AS ENUM ('APPROVED', 'REVOKED');

-- CreateTable
CREATE TABLE "DeviceProvision" (
    "id" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "label" TEXT,
    "status" "DeviceProvisionStatus" NOT NULL DEFAULT 'APPROVED',
    "claimedDeviceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceProvision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "aiScanningEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deviceClaimsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceProvision_macAddress_key" ON "DeviceProvision"("macAddress");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceProvision_claimedDeviceId_key" ON "DeviceProvision"("claimedDeviceId");

-- CreateIndex
CREATE INDEX "DeviceProvision_status_createdAt_idx" ON "DeviceProvision"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DeviceProvision" ADD CONSTRAINT "DeviceProvision_claimedDeviceId_fkey" FOREIGN KEY ("claimedDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceProvision" ADD CONSTRAINT "DeviceProvision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
