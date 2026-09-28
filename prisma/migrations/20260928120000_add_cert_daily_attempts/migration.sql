-- TenantMembership.certDayAttempts + certLastAttemptAt — sertifika sınavı günlük deneme sınırı
-- (madde 158 "günde 2 deneme" · kuyruk I-08).
-- Additive + nullable (default YOK) → mevcut kayıtlar DEĞİŞMEZ, veri kaybı YOK, backfill YOK.
--   null = "bugün henüz deneme yok" sayılır; mevcut cooldownUntil molaları aynen geçerli kalır.
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. Uygulama (AYRI TUR, PO "EVET"i ZORUNLU —
--    canlı=lokal aynı Neon): ÖNCE tarihli yedek tablo
--   `CREATE TABLE "TenantMembership_yedek_YYYYMMDD" AS TABLE "TenantMembership";` (satır sayısı 02-ILERLEME'ye),
--   sonra `prisma db execute --file prisma/migrations/20260928120000_add_cert_daily_attempts/migration.sql`
--   + `prisma migrate resolve --applied 20260928120000_add_cert_daily_attempts`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "certDayAttempts" INTEGER;
ALTER TABLE "TenantMembership" ADD COLUMN IF NOT EXISTS "certLastAttemptAt" TIMESTAMP(3);
