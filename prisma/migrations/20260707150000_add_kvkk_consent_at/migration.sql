-- K2: KVKK açık rıza zaman damgası
-- selfServeRegister sırasında alınan onayı DB'ye kaydeder (KVKK Md.5 ispat yükü).
-- Nullable: migration öncesi kayıtlar NULL olacak (veri kaybı yok).

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "kvkkConsentAt" TIMESTAMP(3);
