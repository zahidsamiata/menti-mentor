-- AN-52-1 — ProductSurveyResponse: ürün-içi otomatik, isteğe bağlı geri bildirim anketi
-- cevap tablosu (persona/davranış varsayımlarını sınayan 7 soru — S1-S7).
-- Additive: yalnız YENİ tablo + indeks + FK ekler. Mevcut hiçbir tabloya ALTER YOK, mevcut
-- veri ETKİLENMEZ (bu tablo daha önce hiç yoktu — yedek konusu YOK, bkz. PR açıklaması).
--
-- Tasarım: "tek kutu, tek migration" (KARAR-80/M12) — Consent modeliyle AYNI ilke: yeni bir
-- soru eklemek (S8, S9...) yeni bir migration İSTEMEZ, yalnız kodda yeni questionKey sabiti
-- eklenir (bkz. src/services/surveyQuestions.ts).
-- Kaynak: docs/raporlar/kesif/an52-urun-ici-geri-bildirim-plani-2026-09-27.md §3.2.
--
-- Neon shadow-DB uyumu: tablo/indeks IF NOT EXISTS (idempotent), FK için DO $$ + duplicate_object
-- guard (PostgreSQL "ADD CONSTRAINT IF NOT EXISTS" desteklemiyor).
--
-- Uygulama (PO'nun EVET'i + tarihli karar kartı sonrası, CANLI=LOKAL AYNI Neon kuralı):
--   `prisma db execute --file <bu dosya>` + ardından
--   `prisma migrate resolve --applied 20260927120000_add_product_survey_response`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)
--
-- Geri alma (yeni tablo — mevcut veriye dokunmadığından geri almak da mevcut veriyi ETKİLEMEZ):
--   DROP TABLE IF EXISTS "ProductSurveyResponse";

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductSurveyResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerKey" TEXT,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    CONSTRAINT "ProductSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: "1 kez kuralı" — aynı soru aynı kullanıcıya en fazla 1 kez, DB seviyesinde garanti
CREATE UNIQUE INDEX IF NOT EXISTS "ProductSurveyResponse_userId_questionKey_key" ON "ProductSurveyResponse"("userId", "questionKey");

-- CreateIndex: tenant-bazlı toplu sorgular (ileride admin AGGREGATE görünümü — AN-52-7)
CREATE INDEX IF NOT EXISTS "ProductSurveyResponse_tenantId_questionKey_idx" ON "ProductSurveyResponse"("tenantId", "questionKey");

-- AddForeignKey: ProductSurveyResponse.userId → User.id (idempotent guard)
DO $$ BEGIN
  ALTER TABLE "ProductSurveyResponse" ADD CONSTRAINT "ProductSurveyResponse_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey: ProductSurveyResponse.tenantId → Tenant.id (idempotent guard)
DO $$ BEGIN
  ALTER TABLE "ProductSurveyResponse" ADD CONSTRAINT "ProductSurveyResponse_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
