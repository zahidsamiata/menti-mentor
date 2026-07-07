-- CreateEnum
CREATE TYPE "OptInInitiator" AS ENUM ('MENTOR', 'MENTI');

-- AlterTable
ALTER TABLE "VisibilityOptIn" ADD COLUMN     "initiatedBy" "OptInInitiator" NOT NULL DEFAULT 'MENTOR',
ADD COLUMN     "requestMessage" TEXT;

-- CreateIndex
CREATE INDEX "JobListing_tenantId_isActive_idx" ON "JobListing"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "MatchRequest_tenantId_targetType_targetId_idx" ON "MatchRequest"("tenantId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "SystemLog_level_category_createdAt_idx" ON "SystemLog"("level", "category", "createdAt");

-- CreateIndex
CREATE INDEX "User_tenantId_id_idx" ON "User"("tenantId", "id");

-- CreateIndex
CREATE INDEX "User_tenantId_discType_idx" ON "User"("tenantId", "discType");

-- CreateIndex
CREATE INDEX "User_tenantId_needsOrientation_idx" ON "User"("tenantId", "needsOrientation");

-- CreateIndex
CREATE INDEX "VisibilityOptIn_tenantId_status_idx" ON "VisibilityOptIn"("tenantId", "status");

-- CreateIndex
CREATE INDEX "VisibilityOptIn_mentorId_initiatedBy_status_idx" ON "VisibilityOptIn"("mentorId", "initiatedBy", "status");
