-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "tenantVocabulary" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bioSummary" TEXT,
ADD COLUMN     "expertiseDetails" TEXT,
ADD COLUMN     "needsOrientation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetAudience" TEXT;

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "mentiId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PENDING',
    "hasFeedback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "mentiId" TEXT NOT NULL,
    "guidanceScore" INTEGER,
    "resourceSharingScore" INTEGER,
    "trustScore" INTEGER,
    "preparednessScore" INTEGER,
    "proactivityScore" INTEGER,
    "keyLearnings" TEXT,
    "specificComments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meeting_tenantId_idx" ON "Meeting"("tenantId");

-- CreateIndex
CREATE INDEX "Meeting_mentorId_idx" ON "Meeting"("mentorId");

-- CreateIndex
CREATE INDEX "Meeting_mentiId_idx" ON "Meeting"("mentiId");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_meetingId_key" ON "Feedback"("meetingId");

-- CreateIndex
CREATE INDEX "Feedback_tenantId_idx" ON "Feedback"("tenantId");

-- CreateIndex
CREATE INDEX "Feedback_mentorId_idx" ON "Feedback"("mentorId");

-- CreateIndex
CREATE INDEX "Feedback_mentiId_idx" ON "Feedback"("mentiId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_mentiId_fkey" FOREIGN KEY ("mentiId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_mentiId_fkey" FOREIGN KEY ("mentiId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
