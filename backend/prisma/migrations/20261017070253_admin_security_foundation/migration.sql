-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "admin_security";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authInvalidBefore" TIMESTAMP(3),
ADD COLUMN     "authVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "admin_security"."AdminChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "supabaseUserId" TEXT NOT NULL,
    "challengeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "client" TEXT NOT NULL,
    "origin" TEXT,

    CONSTRAINT "AdminChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_security"."AdminSessionVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supabaseSessionId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "authVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdminSessionVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_security"."AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminChallenge_challengeHash_key" ON "admin_security"."AdminChallenge"("challengeHash");

-- CreateIndex
CREATE INDEX "AdminChallenge_userId_createdAt_idx" ON "admin_security"."AdminChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminChallenge_expiresAt_idx" ON "admin_security"."AdminChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSessionVerification_supabaseSessionId_key" ON "admin_security"."AdminSessionVerification"("supabaseSessionId");

-- CreateIndex
CREATE INDEX "AdminSessionVerification_userId_expiresAt_idx" ON "admin_security"."AdminSessionVerification"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AdminSessionVerification_expiresAt_idx" ON "admin_security"."AdminSessionVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_id_idx" ON "admin_security"."AuditLog"("createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "admin_security"."AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_createdAt_idx" ON "admin_security"."AuditLog"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "admin_security"."AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "admin_security"."AdminChallenge" ADD CONSTRAINT "AdminChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_security"."AdminSessionVerification" ADD CONSTRAINT "AdminSessionVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_security"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
