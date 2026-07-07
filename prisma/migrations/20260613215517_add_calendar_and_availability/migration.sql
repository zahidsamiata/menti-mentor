-- CreateEnum
CREATE TYPE "MeetingFormat" AS ENUM ('ONLINE', 'IN_PERSON', 'PHONE');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "durationMin" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "format" "MeetingFormat" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "AvailabilityBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvailabilityBlock_userId_tenantId_isActive_idx" ON "AvailabilityBlock"("userId", "tenantId", "isActive");

-- CreateIndex
CREATE INDEX "AvailabilityBlock_tenantId_weekday_isActive_idx" ON "AvailabilityBlock"("tenantId", "weekday", "isActive");

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlock" ADD CONSTRAINT "AvailabilityBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
