-- İş 2 + İş 3: onay/red denetim izi + red gerekçesi.
-- Additive + nullable → mevcut kayıtlar bozulmaz, veri kaybı yok.
-- Neon shadow-DB güvenli deseni: IF NOT EXISTS (db execute ile uygulanır, migrate resolve --applied).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
