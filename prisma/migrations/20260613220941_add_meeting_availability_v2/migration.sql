/*
  Warnings:

  - You are about to drop the column `mentiId` on the `Meeting` table. All the data in the column will be lost.
  - You are about to drop the column `mentorId` on the `Meeting` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledAt` on the `Meeting` table. All the data in the column will be lost.
  - Added the required column `endsAt` to the `Meeting` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mentiUserId` to the `Meeting` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mentorUserId` to the `Meeting` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startsAt` to the `Meeting` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MeetingStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "MeetingStatus" ADD VALUE 'IN_PROGRESS';

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_mentiId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_mentorId_fkey";

-- DropIndex
DROP INDEX "Meeting_mentiId_idx";

-- DropIndex
DROP INDEX "Meeting_mentorId_idx";

-- AlterTable
ALTER TABLE "AvailabilityBlock" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul';

-- AlterTable
ALTER TABLE "Meeting" DROP COLUMN "mentiId",
DROP COLUMN "mentorId",
DROP COLUMN "scheduledAt",
ADD COLUMN     "endsAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "feedbackPrompted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationText" TEXT,
ADD COLUMN     "locationUrl" TEXT,
ADD COLUMN     "matchId" TEXT,
ADD COLUMN     "mentiUserId" TEXT NOT NULL,
ADD COLUMN     "mentorUserId" TEXT NOT NULL,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "startsAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Meeting_mentorUserId_idx" ON "Meeting"("mentorUserId");

-- CreateIndex
CREATE INDEX "Meeting_mentiUserId_idx" ON "Meeting"("mentiUserId");

-- CreateIndex
CREATE INDEX "Meeting_matchId_idx" ON "Meeting"("matchId");

-- CreateIndex
CREATE INDEX "Meeting_tenantId_status_idx" ON "Meeting"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Meeting_tenantId_startsAt_idx" ON "Meeting"("tenantId", "startsAt");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_mentorUserId_fkey" FOREIGN KEY ("mentorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_mentiUserId_fkey" FOREIGN KEY ("mentiUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
