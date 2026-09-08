-- CertificationOption.internalNote — sertifika senaryolarının 🔒 iç notları (madde 163).
-- Additive + nullable (TEXT, default YOK) → mevcut kayıtlar bozulmaz, veri kaybı YOK, backfill YOK.
-- 🔒 Bu alan kullanıcıya HİÇBİR AŞAMADA gösterilmez. explanation/outcome kullanıcıya dönüktür; bu alan DEĞİL.
--    Sızma yok: FE-dönük okumalar explicit `select` (sınav=key,label · sonuç=competencyScore/explanation/outcome).
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. F.13 kuralı: çalıştırma turunda ÖNCE CertificationOption
--    için yedek tablo alınır (Neon restore penceresi 6 saat).
-- Uygulama (AYRI TUR, PO onayı ZORUNLU — canlı=lokal aynı Neon):
--   `prisma db execute --file prisma/migrations/20260909000000_add_internal_note/migration.sql`
--   + ardından `prisma migrate resolve --applied 20260909000000_add_internal_note`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "CertificationOption" ADD COLUMN IF NOT EXISTS "internalNote" TEXT;
