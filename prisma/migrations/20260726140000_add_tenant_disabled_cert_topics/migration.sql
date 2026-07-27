-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_tenant_disabled_cert_topics
-- Kapsam: Kurum (tenant) bazında kapatılan sertifika konusu slug'ları.
--   Tenant.disabledCertTopics TEXT[] DEFAULT '{}' (additive; mevcut satırlar boş dizi).
-- Neon uyumlu: ADD COLUMN IF NOT EXISTS (idempotent; shadow-DB gerekmez).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "disabledCertTopics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
