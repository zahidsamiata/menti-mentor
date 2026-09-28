-- AN-36 / G1-12 — Tenant yasal kimlik alanları (KVKK Veri İşleyen Sözleşmesi için).
-- Additive + nullable (TEXT / TIMESTAMP, default YOK) → mevcut kayıtlar bozulmaz, veri kaybı YOK,
-- backfill YOK, mevcut hiçbir kolonun ANLAMI değişmez.
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. 🔵 kapı: merge YALNIZ PO "EVET"i + tarihli
--    "Tenant" yedek tablosu alındıktan sonra (Neon restore penceresi 6 saat). Dockerfile açılışta
--    `migrate deploy` çalıştırır → merge = canlı DB değişikliği.
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "legalAddress" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "kepAddress" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "mersisNo" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "taxOffice" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "taxNumber" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "legalInfoUpdatedAt" TIMESTAMP(3);
