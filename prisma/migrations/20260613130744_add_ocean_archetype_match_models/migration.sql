-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EARLY_EXIT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Checkpoint" AS ENUM ('DAY_3', 'DAY_14', 'DAY_30');

-- CreateEnum
CREATE TYPE "ProfileSource" AS ENUM ('DISC_DERIVED', 'HYBRID');

-- DropForeignKey
ALTER TABLE "PendingTag" DROP CONSTRAINT "PendingTag_submittedBy_fkey";

-- DropForeignKey
ALTER TABLE "PendingTag" DROP CONSTRAINT "PendingTag_tenantId_fkey";

-- DropIndex
DROP INDEX "User_tenantId_email_key";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "approvalStatus" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discI" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discC" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "oceanO" DOUBLE PRECISION,
    "oceanC" DOUBLE PRECISION,
    "oceanE" DOUBLE PRECISION,
    "oceanA" DOUBLE PRECISION,
    "oceanN" DOUBLE PRECISION,
    "archetype" TEXT,
    "archetypeRole" "UserRole",
    "profileSource" "ProfileSource" NOT NULL DEFAULT 'DISC_DERIVED',

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "mentiId" TEXT NOT NULL,
    "predictedScore" DOUBLE PRECISION NOT NULL,
    "sectorScore" DOUBLE PRECISION NOT NULL,
    "characterScore" DOUBLE PRECISION NOT NULL,
    "mentorArchetype" TEXT NOT NULL,
    "mentiArchetype" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchFeedback" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "checkpoint" "Checkpoint" NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "progressScore" INTEGER,
    "rapportScore" INTEGER,
    "earlyExit" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserProfile_userId_idx" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserProfile_archetype_idx" ON "UserProfile"("archetype");

-- CreateIndex
CREATE INDEX "Match_mentorId_idx" ON "Match"("mentorId");

-- CreateIndex
CREATE INDEX "Match_mentiId_idx" ON "Match"("mentiId");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Match_createdAt_idx" ON "Match"("createdAt");

-- CreateIndex
CREATE INDEX "MatchFeedback_matchId_idx" ON "MatchFeedback"("matchId");

-- CreateIndex
CREATE INDEX "MatchFeedback_checkpoint_idx" ON "MatchFeedback"("checkpoint");

-- CreateIndex
CREATE UNIQUE INDEX "MatchFeedback_matchId_checkpoint_fromUserId_key" ON "MatchFeedback"("matchId", "checkpoint", "fromUserId");

-- AddForeignKey
ALTER TABLE "PendingTag" ADD CONSTRAINT "PendingTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingTag" ADD CONSTRAINT "PendingTag_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_mentiId_fkey" FOREIGN KEY ("mentiId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchFeedback" ADD CONSTRAINT "MatchFeedback_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
