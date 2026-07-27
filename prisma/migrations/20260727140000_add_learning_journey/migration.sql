-- Migration: add_learning_journey
-- Kapsam: Öğrenme Yolculuğu (LearningStage + LearningStageHide) + TenantMembership ek alanı.
-- Neon uyumlu: enum DO-block guard, tablolar "CREATE TABLE IF NOT EXISTS",
--              yeni sütun nullable + "ADD COLUMN IF NOT EXISTS" (idempotent; shadow-DB gerekmez).

-- ── Enum: LearningAudience (idempotent) ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "LearningAudience" AS ENUM ('MENTOR', 'MENTI');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── LearningStage ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LearningStage" (
    "id"             TEXT NOT NULL,
    "tenantId"       TEXT,
    "audience"       "LearningAudience" NOT NULL,
    "order"          INTEGER NOT NULL DEFAULT 0,
    "title"          TEXT NOT NULL,
    "situationText"  TEXT NOT NULL,
    "learningGoal"   TEXT NOT NULL,
    "authoringGuide" TEXT,
    "isStkSpecific"  BOOLEAN NOT NULL DEFAULT false,
    "choices"        JSONB NOT NULL,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningStage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LearningStage_tenantId_idx" ON "LearningStage"("tenantId");
CREATE INDEX IF NOT EXISTS "LearningStage_audience_idx" ON "LearningStage"("audience");
CREATE INDEX IF NOT EXISTS "LearningStage_isActive_idx" ON "LearningStage"("isActive");

-- ── LearningStageHide ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LearningStageHide" (
    "id"       TEXT NOT NULL,
    "stageId"  TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningStageHide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LearningStageHide_stageId_tenantId_key" ON "LearningStageHide"("stageId", "tenantId");
CREATE INDEX IF NOT EXISTS "LearningStageHide_tenantId_idx" ON "LearningStageHide"("tenantId");

-- ── Foreign keys (idempotent guard) ──────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "LearningStage"
    ADD CONSTRAINT "LearningStage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "LearningStageHide"
    ADD CONSTRAINT "LearningStageHide_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "LearningStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "LearningStageHide"
    ADD CONSTRAINT "LearningStageHide_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── TenantMembership: öğrenme yolculuğu tamamlanma anı (nullable, additive) ───
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "learningJourneyCompletedAt" TIMESTAMP(3);
