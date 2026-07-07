-- User KVKK açık rıza zaman damgası
-- /api/auth/register sırasında alınan bireysel kullanıcı onayını kayıt altına alır (KVKK Md.5).
-- Nullable: migration öncesi kayıtlar ve OAuth akışları NULL olabilir.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kvkkConsentAt" TIMESTAMP(3);
