-- better-auth 1.7.3+ validates the Prisma schema at startup (including in
-- production) and rejects every auth request on a mismatch. These columns have
-- been expected by the twoFactor and organization plugins since 1.6 but were
-- never added here. All are additive with defaults/nullable, so existing rows
-- stay valid and no backfill is required.

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" INTEGER DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "verified" BOOLEAN DEFAULT true;
