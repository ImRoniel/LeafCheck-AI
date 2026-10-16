-- Additive only. Existing passwords, IDs, sessions and relations are preserved.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "supabaseUserId" TEXT;

CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
