-- Faz 3: Taslak tenant kurtarma e-postası alanları
-- Bu alanlar Faz 3'te `db push --accept-data-loss` ile canlıya uygulanmıştı.
-- Bu migration, versiyonlanmış kaydı tamamlar; temiz ortamlarda bu üç sütunu oluşturur.

-- AlterTable: Tenant
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "unsubscribeToken"    TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "reminderEmailSentAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "unsubscribedAt"      TIMESTAMP(3);

-- UNIQUE kısıtı — sütun zaten mevcutsa kısıtı tekrar eklememek için kontrol gerekir.
-- Kısıtın var olup olmadığını kontrol et; yoksa ekle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Tenant_unsubscribeToken_key'
  ) THEN
    ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_unsubscribeToken_key" UNIQUE ("unsubscribeToken");
  END IF;
END $$;
