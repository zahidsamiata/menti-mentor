-- AJ-111 (md.111 / G2-06) — eşleştirme gevşetme oranı: MatchingFallbackDailyStat tablosu.
-- Additive: yalnız YENİ tablo + birincil anahtar indeksi + FK ekler; mevcut hiçbir tabloya/veriye
-- DOKUNMAZ (ALTER yok, backfill yok, veri kaybı yok). Yeni tablo boş başlar → yedek GEREKMEZ.
-- İçerik: kurum + İstanbul günü + fallback kademesi başına TOPLU SAYAÇ — kişi düzeyinde alan YOK.
-- Birincil anahtar (tenantId, day, level) aynı zamanda okuma indeksidir: platform analizi
-- "tenantId = ? AND day >= ?" sorar → PK'nin ön eki; ayrı indeks gereksiz.
-- Neon shadow-DB uyumu: tablo IF NOT EXISTS, FK DO $$ + duplicate_object guard (idempotent).
-- Uygulama: merge → Dockerfile açılışta `prisma migrate deploy` (PO "EVET"i sonrası).
-- (CLAUDE.md kuralı: `db push --accept-data-loss` YASAK.)

-- CreateTable: MatchingFallbackDailyStat
CREATE TABLE IF NOT EXISTS "MatchingFallbackDailyStat" (
    "tenantId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "level" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MatchingFallbackDailyStat_pkey" PRIMARY KEY ("tenantId","day","level")
);

-- AddForeignKey: MatchingFallbackDailyStat.tenantId → Tenant.id (idempotent guard)
-- ON DELETE CASCADE: kurum silinirse o kurumun sayaçları anlamsızdır, kurum silmeyi engellemesin.
DO $$ BEGIN
  ALTER TABLE "MatchingFallbackDailyStat" ADD CONSTRAINT "MatchingFallbackDailyStat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
