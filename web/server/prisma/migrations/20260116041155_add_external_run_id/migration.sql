/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,projectId,externalId]` on the table `runs` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "externalId" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "runs_organizationId_projectId_externalId_key" ON "runs"("organizationId", "projectId", "externalId");
