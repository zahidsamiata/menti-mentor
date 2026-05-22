/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,email]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TimeCommitment" AS ENUM ('AYDA_1', 'AYDA_2_3', 'HAFTADA_1', 'HAFTADA_2_PLUS');

-- CreateEnum
CREATE TYPE "InteractionStyle" AS ENUM ('GOREV_BAZLI', 'SOHBET_BAZLI');

-- CreateEnum
CREATE TYPE "ExpectationCategory" AS ENUM ('KARIYER_YONLENDIRME', 'TEKNIK_BECERI', 'IS_STAJ_BAGLANTISI', 'GIRISIMCILIK', 'KISISEL_GELISIM', 'SEKTOR_TANIMA');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "enneagramWing" TEXT,
ADD COLUMN     "expectationCategories" "ExpectationCategory"[] DEFAULT ARRAY[]::"ExpectationCategory"[],
ADD COLUMN     "interactionStyle" "InteractionStyle",
ADD COLUMN     "rematchCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rematchPriority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeCommitment" "TimeCommitment";

-- CreateTable
CREATE TABLE "FeedbackLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "mentiId" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "starRating" INTEGER NOT NULL,
    "difficulty" TEXT,
    "npsScore" INTEGER,
    "goalAchieved" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCombinationScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "discCombination" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchCombinationScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackLog_tenantId_idx" ON "FeedbackLog"("tenantId");

-- CreateIndex
CREATE INDEX "FeedbackLog_mentorId_idx" ON "FeedbackLog"("mentorId");

-- CreateIndex
CREATE INDEX "FeedbackLog_mentiId_idx" ON "FeedbackLog"("mentiId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackLog_mentorId_mentiId_phase_key" ON "FeedbackLog"("mentorId", "mentiId", "phase");

-- CreateIndex
CREATE INDEX "MatchCombinationScore_tenantId_idx" ON "MatchCombinationScore"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCombinationScore_tenantId_discCombination_key" ON "MatchCombinationScore"("tenantId", "discCombination");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "FeedbackLog" ADD CONSTRAINT "FeedbackLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLog" ADD CONSTRAINT "FeedbackLog_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackLog" ADD CONSTRAINT "FeedbackLog_mentiId_fkey" FOREIGN KEY ("mentiId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCombinationScore" ADD CONSTRAINT "MatchCombinationScore_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
