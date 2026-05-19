-- AlterTable: soft-delete support for API keys.
-- Runs reference their creator key via Runs.creatorApiKeyId (a required FK
-- with RESTRICT), so keys cannot be hard-deleted once they have logged runs.
-- A non-null "revokedAt" marks the key as revoked: it is rejected at every
-- auth path and hidden from listApiKeys.
ALTER TABLE "api_key" ADD COLUMN "revokedAt" TIMESTAMP(3);
