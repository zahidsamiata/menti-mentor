-- AN-26 (KARAR-53 ④) — Conversation: yanıtsız mentör hatırlatma/eskalasyon guard alanları.
-- mentorReminder1SentAt (3. gün) · mentorReminder2SentAt (7. gün) · adminEscalatedAt (10. gün).
-- Additive + nullable (TIMESTAMP(3), default YOK) → mevcut kayıtlar bozulmaz, veri kaybı YOK, backfill YOK.
-- Cron yalnız son 14 günde açılmış konuşmalara bakar → yayın anında eski konuşmalara toplu e-posta gitmez.
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. Çalıştırma turunda ÖNCE "Conversation" için
--    tarihli yedek tablo alınır (adı + satır sayısı 02-ILERLEME.md'ye yazılır).
-- Uygulama (AYRI TUR, PO onayı ZORUNLU — canlı=lokal aynı Neon olabilir):
--   `prisma db execute --file prisma/migrations/20260926100000_add_conversation_reminder_guards/migration.sql`
--   + ardından `prisma migrate resolve --applied 20260926100000_add_conversation_reminder_guards`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "mentorReminder1SentAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "mentorReminder2SentAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "adminEscalatedAt" TIMESTAMP(3);
