-- Message.kind + Message.proposedStartAt — AN-27: "zaman önerisi" mesaj tipi (KARAR-53 CEVAP ②④).
-- Menti, normal mesaj kanalından YAPILANDIRILMIŞ bir mesaj gönderir: NEDEN görüşmek istediği
-- (content'te, düz metin) + talep ettiği ZAMAN (proposedStartAt). Mentör bunu `kind` sayesinde
-- sıradan mesajdan ayırt eder.
--   kind            TEXT NULL  — NULL = sıradan mesaj (mevcut TÜM satırlar), 'TIME_PROPOSAL' = zaman önerisi.
--                               İzin listesi uygulamada (Zod) — enum DEĞİL: yeni tip eklemek ayrı enum
--                               migration'ı gerektirmesin.
--   proposedStartAt TIMESTAMP(3) NULL — yalnız zaman önerisinde dolu.
-- Additive + nullable, default YOK → mevcut mesajlara DOKUNULMAZ, veri kaybı YOK, backfill YOK.
-- Neon shadow-DB güvenli deseni: ADD COLUMN IF NOT EXISTS (idempotent, iki kez çalışsa da bozmaz).
-- Ayrı küçük migration (KARAR-1 / K-15 birleşik migration'ına katılmadı): K-15 yalnız
-- "AvailabilityBlock" tablosuna dokunur; bu dosya yalnız "Message"a. Tablo kesişimi yok → ayrı PO
-- "EVET"i ve ayrı geri alınabilirlik.
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. Çalıştırma turunda ÖNCE "Message" için tarihli
--    yedek tablo alınır (Neon restore penceresi 6 saat).
-- Uygulama (AYRI TUR, PO onayı ZORUNLU — canlı=lokal aynı Neon):
--   `prisma db execute --file prisma/migrations/20260929130000_add_message_time_proposal/migration.sql`
--   + ardından `prisma migrate resolve --applied 20260929130000_add_message_time_proposal`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "proposedStartAt" TIMESTAMP(3);
