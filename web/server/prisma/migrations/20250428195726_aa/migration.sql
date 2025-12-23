-- DropForeignKey
ALTER TABLE "organization_subscription" DROP CONSTRAINT "organization_subscription_organizationId_fkey";

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_id_fkey" FOREIGN KEY ("id") REFERENCES "organization_subscription"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
