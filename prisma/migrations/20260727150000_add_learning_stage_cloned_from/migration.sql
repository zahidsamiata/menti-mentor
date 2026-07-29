-- Migration: add_learning_stage_cloned_from
-- Kapsam: LearningStage.clonedFromId — "özelleştir" ile klonlanan aşamanın kaynak global id'si.
-- Neon uyumlu: tek sütun, nullable, "ADD COLUMN IF NOT EXISTS" (idempotent; shadow-DB gerekmez).

ALTER TABLE "LearningStage" ADD COLUMN IF NOT EXISTS "clonedFromId" TEXT;
