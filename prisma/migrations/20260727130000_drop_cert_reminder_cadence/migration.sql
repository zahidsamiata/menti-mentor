-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: drop_cert_reminder_cadence
-- Kapsam: Mentöre otomatik mail (maliyet) modelinden vazgeçildi; yerine STK
--   yöneticisine uygulama-içi bildirim kullanılıyor. Mail cadence alanları gereksiz:
--   certReminderCount, certLastReminderAt kaldırılır (yeni eklenmişti, boş).
-- Neon uyumlu: DROP COLUMN IF EXISTS (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TenantMembership" DROP COLUMN IF EXISTS "certReminderCount";
ALTER TABLE "TenantMembership" DROP COLUMN IF EXISTS "certLastReminderAt";
