-- TenantMembership.learningJourneyStageIds — Öğrenme Yolculuğu kalıcı ilerleme (kuyruk P-08).
-- Kişinin geçtiği aşamaların id'leri; "kaçıncı aşamadayım" buradan türetilir. Seçilen şık TUTULMAZ.
-- Additive: boş dizi varsayılanıyla eklenir → mevcut kayıtlar "henüz aşama geçilmedi" sayılır,
--   hiçbir mevcut değer DEĞİŞMEZ, veri kaybı YOK, backfill YOK
--   (aynı desen: 20260727120000_add_membership_cert_retry_reminder → certWrongTopics).
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. Uygulama (AYRI TUR, PO "EVET"i ZORUNLU —
--    canlı=lokal aynı Neon): ÖNCE tarihli yedek tablo
--   `CREATE TABLE "TenantMembership_yedek_YYYYMMDD" AS TABLE "TenantMembership";` (satır sayısı 02-ILERLEME'ye),
--   sonra `prisma db execute --file prisma/migrations/20260929000000_add_learning_journey_progress/migration.sql`
--   + `prisma migrate resolve --applied 20260929000000_add_learning_journey_progress`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "learningJourneyStageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
