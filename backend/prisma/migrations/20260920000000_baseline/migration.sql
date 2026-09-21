-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'LEAD_DEV');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "location" TEXT,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "healthStatus" TEXT NOT NULL DEFAULT 'healthy',
    "minMoisture" DOUBLE PRECISION NOT NULL DEFAULT 30.0,
    "maxMoisture" DOUBLE PRECISION NOT NULL DEFAULT 80.0,
    "lastScannedAt" TIMESTAMP(3),
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantSpecCache" (
    "id" TEXT NOT NULL,
    "speciesName" TEXT NOT NULL,
    "commonName" TEXT,
    "idealLuxMin" INTEGER,
    "idealLuxMax" INTEGER,
    "idealTempMinC" DOUBLE PRECISION,
    "idealTempMaxC" DOUBLE PRECISION,
    "idealHumidityMin" DOUBLE PRECISION,
    "idealHumidityMax" DOUBLE PRECISION,
    "idealPhMin" DOUBLE PRECISION,
    "idealPhMax" DOUBLE PRECISION,
    "wateringFrequency" TEXT,
    "sunlight" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlantSpecCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlantIdentification" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "speciesName" TEXT NOT NULL,
    "commonName" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlantIdentification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "healthStatus" TEXT NOT NULL,
    "diagnoses" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "rawAnalysisText" TEXT,
    "speciesName" TEXT,
    "telemetrySnapshot" JSONB,
    "idealSpecs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Device_macAddress_key" ON "Device"("macAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PlantSpecCache_speciesName_key" ON "PlantSpecCache"("speciesName");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plant" ADD CONSTRAINT "Plant_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlantIdentification" ADD CONSTRAINT "PlantIdentification_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
