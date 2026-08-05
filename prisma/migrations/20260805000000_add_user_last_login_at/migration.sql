-- Retention temeli: kullanıcının son kimlik-doğrulama aktivitesi (login veya token yenileme).
-- Tenant admin + platform admin retention/pasiflik metrikleri bu alandan türer.
-- Nullable: mevcut kayıtlar NULL olur (veri kaybı yok). IF NOT EXISTS: Neon shadow-DB güvenli, idempotent.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
