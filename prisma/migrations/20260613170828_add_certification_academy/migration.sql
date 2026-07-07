-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'CERTIFIED', 'FAILED', 'COOLDOWN');

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "certAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "certScore" DOUBLE PRECISION,
ADD COLUMN     "certificationStatus" "CertificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "certifiedAt" TIMESTAMP(3),
ADD COLUMN     "cooldownUntil" TIMESTAMP(3),
ADD COLUMN     "isCertified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- CreateTable
CREATE TABLE "CertificationQuestion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "isRedLine" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificationOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "competencyScore" INTEGER NOT NULL,

    CONSTRAINT "CertificationOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificationQuestion_code_key" ON "CertificationQuestion"("code");

-- CreateIndex
CREATE INDEX "CertificationQuestion_isActive_idx" ON "CertificationQuestion"("isActive");

-- CreateIndex
CREATE INDEX "CertificationOption_questionId_idx" ON "CertificationOption"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationOption_questionId_key_key" ON "CertificationOption"("questionId", "key");

-- AddForeignKey
ALTER TABLE "CertificationOption" ADD CONSTRAINT "CertificationOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CertificationQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
