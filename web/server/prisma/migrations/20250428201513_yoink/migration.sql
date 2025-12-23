-- DropForeignKey
ALTER TABLE "organization" DROP CONSTRAINT "organization_id_fkey";

-- AddForeignKey
ALTER TABLE "organization_subscription" ADD CONSTRAINT "organization_subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
