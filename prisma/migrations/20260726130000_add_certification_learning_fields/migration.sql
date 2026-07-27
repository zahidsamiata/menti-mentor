-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_certification_learning_fields
-- Kapsam: Sertifika öğrenme akışı için ek alanlar (hepsi nullable, additive).
--   CertificationQuestion: topic, variant   (aynı konunun varyantlarını bağlar)
--   CertificationOption:   explanation, outcome ("neden doğru/yanlış" + rozet)
-- Neon uyumlu: tüm sütunlar "ADD COLUMN IF NOT EXISTS" (idempotent; shadow-DB gerekmez).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CertificationQuestion" ADD COLUMN IF NOT EXISTS "topic"   TEXT;
ALTER TABLE "CertificationQuestion" ADD COLUMN IF NOT EXISTS "variant" TEXT;

ALTER TABLE "CertificationOption"   ADD COLUMN IF NOT EXISTS "explanation" TEXT;
ALTER TABLE "CertificationOption"   ADD COLUMN IF NOT EXISTS "outcome"     TEXT;
