-- Conversation.rejectedAt — U-18: mentör mesaj talebini (konuşmayı) nazikçe reddedebilir
-- (KARAR-22 B + KARAR-80/M1). Dolu olunca konuşma kapanır, iki taraf da yeni mesaj yazamaz.
-- Additive + nullable (TIMESTAMP(3), default YOK) → mevcut kayıtlar bozulmaz, veri kaybı YOK, backfill YOK.
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi (bulut oturumu, Neon erişimi yok).
-- Uygulama (AYRI TUR, PO onayı ZORUNLU — canlı=lokal aynı Neon):
--   `prisma db execute --file prisma/migrations/20260926120000_add_conversation_rejected_at/migration.sql`
--   + ardından `prisma migrate resolve --applied 20260926120000_add_conversation_rejected_at`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
