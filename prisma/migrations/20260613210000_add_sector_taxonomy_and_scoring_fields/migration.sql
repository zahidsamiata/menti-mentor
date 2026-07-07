-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_sector_taxonomy_and_scoring_fields
-- Kapsam: SJT modeli, IndustryNode taksonomi ağacı, UserProfile sektör alanları,
--         MatchStatus.DISSOLVED, ProfileSource.SJT_ENRICHED, Match.tenantId
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "QuestionTier" AS ENUM ('CORE', 'FOLLOWUP');

-- CreateEnum
CREATE TYPE "AnswerFormat" AS ENUM ('SINGLE', 'MOST_LEAST');

-- AlterEnum: CANCELLED → DISSOLVED (MatchStatus)
ALTER TYPE "MatchStatus" RENAME VALUE 'CANCELLED' TO 'DISSOLVED';

-- AlterEnum: ProfileSource'a SJT_ENRICHED eklendi
ALTER TYPE "ProfileSource" ADD VALUE 'SJT_ENRICHED';

-- CreateTable: SjtQuestion
CREATE TABLE "SjtQuestion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tier" "QuestionTier" NOT NULL,
    "answerFormat" "AnswerFormat" NOT NULL DEFAULT 'SINGLE',
    "forRole" "UserRole" NOT NULL,
    "scenario" TEXT NOT NULL,
    "triggersOn" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SjtQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SjtOption
CREATE TABLE "SjtOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "signalsArchetype" TEXT,

    CONSTRAINT "SjtOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable: IndustryNode (hiyerarşik sektör taksonomi ağacı)
CREATE TABLE "IndustryNode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "IndustryNode_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Match — tenantId alanı eklendi (NOT NULL)
ALTER TABLE "Match" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Match" ALTER COLUMN "tenantId" DROP DEFAULT;

-- AlterTable: UserProfile — 7 yeni sektör skoru alanı
ALTER TABLE "UserProfile"
    ADD COLUMN "industryCode"  TEXT,
    ADD COLUMN "yearsExp"      INTEGER,
    ADD COLUMN "skillTags"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "goalTags"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "schools"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "companies"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "communities"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable: UserProfile — archetypeRole NOT NULL + default MENTI
ALTER TABLE "UserProfile" ALTER COLUMN "archetypeRole" SET NOT NULL;
ALTER TABLE "UserProfile" ALTER COLUMN "archetypeRole" SET DEFAULT 'MENTI'::"UserRole";

-- CreateIndex: SjtQuestion
CREATE UNIQUE INDEX "SjtQuestion_code_key"              ON "SjtQuestion"("code");
CREATE INDEX        "SjtQuestion_tier_forRole_isActive_idx" ON "SjtQuestion"("tier", "forRole", "isActive");

-- CreateIndex: SjtOption
CREATE INDEX        "SjtOption_questionId_idx"          ON "SjtOption"("questionId");
CREATE UNIQUE INDEX "SjtOption_questionId_key_key"      ON "SjtOption"("questionId", "key");

-- CreateIndex: IndustryNode
CREATE UNIQUE INDEX "IndustryNode_code_key"             ON "IndustryNode"("code");
CREATE INDEX        "IndustryNode_parentId_idx"         ON "IndustryNode"("parentId");
CREATE INDEX        "IndustryNode_depth_idx"            ON "IndustryNode"("depth");

-- CreateIndex: Match — unique pair + arketip bileşik index
CREATE UNIQUE INDEX "Match_mentorId_mentiId_key"                    ON "Match"("mentorId", "mentiId");
CREATE INDEX        "Match_mentorArchetype_mentiArchetype_idx"       ON "Match"("mentorArchetype", "mentiArchetype");

-- AddForeignKey: SjtOption → SjtQuestion (CASCADE)
ALTER TABLE "SjtOption" ADD CONSTRAINT "SjtOption_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "SjtQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: IndustryNode → IndustryNode (öz-referanslı)
ALTER TABLE "IndustryNode" ADD CONSTRAINT "IndustryNode_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "IndustryNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterForeignKey: Match — RESTRICT → CASCADE
ALTER TABLE "Match" DROP CONSTRAINT "Match_mentorId_fkey";
ALTER TABLE "Match" DROP CONSTRAINT "Match_mentiId_fkey";

ALTER TABLE "Match" ADD CONSTRAINT "Match_mentorId_fkey"
    FOREIGN KEY ("mentorId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_mentiId_fkey"
    FOREIGN KEY ("mentiId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterForeignKey: MatchFeedback — RESTRICT → CASCADE
ALTER TABLE "MatchFeedback" DROP CONSTRAINT "MatchFeedback_matchId_fkey";

ALTER TABLE "MatchFeedback" ADD CONSTRAINT "MatchFeedback_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
