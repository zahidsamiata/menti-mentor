-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_membership_cert_retry_reminder
-- Kapsam: Sertifika deneme döngüsü + hatırlatma alanları (TenantMembership).
--   certWrongTopics (ağırlıklı tekrar), certReminderCount, certLastReminderAt,
--   certAdminNotifiedAt. Hepsi additive; mevcut satırlar varsayılan alır.
-- Neon uyumlu: ADD COLUMN IF NOT EXISTS (idempotent; shadow-DB gerekmez).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "certWrongTopics"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "certReminderCount"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "certLastReminderAt"  TIMESTAMP(3);
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "certAdminNotifiedAt" TIMESTAMP(3);
