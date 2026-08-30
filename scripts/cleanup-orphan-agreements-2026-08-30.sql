-- BİR KEZLİK veri temizliği (2026-08-30) — 150 öksüz MentorshipAgreement test-fixture satırı.
-- Köken (kanıtlı): İş 4 (commit 7f1cb11, 2026-07-13) feedback-loop testleri CANLI Neon'a yazdı;
--   test-DB guard'ı (assertTestDatabase.ts) 2026-07-29'da geldi (16 gün sonra); tablo FK'siz doğduğu
--   için sahte tenant/mentor/menti id'leri reddedilmedi. Satırlar 6 güne yayılı (07-13/20/25/26/27/29).
--   Detay: docs/raporlar/kesif/sema-drift-2026-08-30.md
-- ⚠️ Koşul TARİHE DEĞİL ÖKSÜZLÜĞE dayanır (tarih kırılgan, 6 güne yayılı). Yalnız gerçek
--   tenant+mentor+menti'ye bağlı OLMAYAN satırları hedefler. Doğrulama: total=150 = öksüz=150 (gerçek satır 0).
-- ⚠️ DELETE geri alınamaz → önce YEDEK alınır ve satır sayısı = 150 teyit edilmeden silmeye geçilmez.
-- Migration DEĞİL (schema değişmez) → migrate history'ye GİRMEZ; db execute / $executeRaw ile bir kez çalışır.
-- ADIM SIRASI (ayrı çalıştırılır, aralarında doğrulama): (0) yedek tablo VAR MI → varsa DUR →
--   (1) YEDEK → say=150 → (2) DELETE → say=150 (yedek sayısı = silinen sayısı = AYNI 150 satır).
-- ⚠️ IF NOT EXISTS KULLANILMAZ (PO düzeltme 1): tablo zaten varsa sessizce atlanır, eski tablodan
--   150 okunur, YEDEKSİZ silmeye yol açar. Varlık ÖNCE ayrı SELECT ile kontrol edilir; çakışırsa hata.
-- ⚠️ SİLME koşulu YEDEK/SAYIM koşuluyla BİREBİR AYNIDIR (PO düzeltme 4): tarih/status/başka ölçüt YOK.

-- ── ADIM 1: YEDEK (geri alma güvencesi) — IF NOT EXISTS YOK, çakışırsa hata istenir ──
CREATE TABLE "MentorshipAgreement_yedek_20260830" AS
SELECT * FROM "MentorshipAgreement" a
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = a."tenantId")
   OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a."mentorId")
   OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a."mentiId");

-- ── ADIM 2: SİLME (yalnız öksüz satırlar) ──
DELETE FROM "MentorshipAgreement" a
WHERE NOT EXISTS (SELECT 1 FROM "Tenant" t WHERE t.id = a."tenantId")
   OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a."mentorId")
   OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a."mentiId");

-- Geri alma (gerekirse): INSERT INTO "MentorshipAgreement" SELECT * FROM "MentorshipAgreement_yedek_20260830";
-- Yedek tablo, PO onayıyla ileride düşürülür (sonraki-tur sözü S26).
