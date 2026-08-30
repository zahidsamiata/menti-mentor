-- 5 eksik FOREIGN KEY eklenir, HEPSİ ON DELETE RESTRICT (PO kararı 2026-08-30).
-- MentorshipAgreement×3 (tenantId/mentorId/mentiId) + UserReport×2 (reporterUserId/targetUserId).
-- Neden: bu iki tablo FK'siz doğdu (drift, F.8) — şema 63 FK bekliyor, fizikselde 58 vardı → bu 5 kapatır.
-- ⚠️ ÖN KOŞUL: MentorshipAgreement 150 öksüz test-satırı BU MIGRATION'DAN ÖNCE ayrı adımda silinir
--    (scripts/cleanup-orphan-agreements-2026-08-30.sql). FK, öksüz satır dururken eklenemez (hata verir).
-- RESTRICT gerekçesi: anonimleştirme satır silmez (CASCADE uyuyan kural olurdu); çift-taraflı kayıt
--    (bir tarafın silinmesi diğerinin geçmişini silmemeli); mevcut ->Tenant FK deseniyle tutarlı.
-- Neon idempotent: PostgreSQL "ADD CONSTRAINT IF NOT EXISTS" desteklemez → DO $$ + duplicate_object guard.
-- Uygulama: prisma db execute --file <bu dosya> + prisma migrate resolve --applied 20260830100000_add_restrict_fks
-- ON UPDATE CASCADE = Prisma varsayılanı; cuid PK'ler değişmediği için pratikte tetiklenmez. PO kararı ON DELETE üzerineydi.

DO $$ BEGIN
  ALTER TABLE "MentorshipAgreement" ADD CONSTRAINT "MentorshipAgreement_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "MentorshipAgreement" ADD CONSTRAINT "MentorshipAgreement_mentorId_fkey"
    FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "MentorshipAgreement" ADD CONSTRAINT "MentorshipAgreement_mentiId_fkey"
    FOREIGN KEY ("mentiId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
