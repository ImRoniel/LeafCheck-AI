-- Schema-only preparation. Do not infer or seed historical pairing intervals here.
-- Keep the entire migration atomic: existing duplicate current assignments must
-- fail without changing application rows or leaving a partially installed schema.
-- A single statement is atomic and lets Prisma record the original failure.
-- An explicit BEGIN would leave its connection aborted before failure logging.
DO $migration$
BEGIN

-- CreateTable (generated from the PostgreSQL schema diff with Prisma 6.19.3)
CREATE TABLE "DevicePairingHistory" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpairedAt" TIMESTAMP(3),

    CONSTRAINT "DevicePairingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevicePairingHistory_plantId_pairedAt_idx" ON "DevicePairingHistory"("plantId", "pairedAt");
CREATE INDEX "DevicePairingHistory_deviceId_unpairedAt_idx" ON "DevicePairingHistory"("deviceId", "unpairedAt");

-- AddForeignKey
-- Defer this NO ACTION check until commit so cascading User deletion can remove
-- its plants/history after its devices. Direct device deletion still fails when
-- any surviving plant history refers to it. Prisma 6 cannot express deferrability.
ALTER TABLE "DevicePairingHistory" ADD CONSTRAINT "DevicePairingHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "DevicePairingHistory" ADD CONSTRAINT "DevicePairingHistory_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Native constraints: Prisma 6 cannot represent partial indexes or CHECK clauses.
-- Preserve Device.plants as a list while enforcing one current plant per device.
CREATE UNIQUE INDEX "Plant_deviceId_current_key" ON "Plant"("deviceId") WHERE "deviceId" IS NOT NULL;
CREATE UNIQUE INDEX "DevicePairingHistory_deviceId_open_key" ON "DevicePairingHistory"("deviceId") WHERE "unpairedAt" IS NULL;
CREATE UNIQUE INDEX "DevicePairingHistory_plantId_open_key" ON "DevicePairingHistory"("plantId") WHERE "unpairedAt" IS NULL;

-- Half-open intervals may have zero duration when two transitions share a
-- millisecond. The pairing writer and verified importer must prevent overlaps.
ALTER TABLE "DevicePairingHistory" ADD CONSTRAINT "DevicePairingHistory_interval_check" CHECK ("unpairedAt" IS NULL OR "unpairedAt" >= "pairedAt");

END;
$migration$;
