-- AN-29 / KARAR-34 SORU 1: kurum türü (ORGANIZATION | COMMUNITY).
-- Additive + nullable → mevcut kurumlar bozulmaz, veri kaybı yok, backfill YOK (NULL = kurum gibi davranır).
-- Neon shadow-DB güvenli deseni: idempotent (tip varsa atla · kolon varsa atla).
DO $$ BEGIN
  CREATE TYPE "TenantKind" AS ENUM ('ORGANIZATION', 'COMMUNITY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "kind" "TenantKind";
