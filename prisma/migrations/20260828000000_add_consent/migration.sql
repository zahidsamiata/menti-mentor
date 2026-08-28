-- G1-07 — KVKK tipli+sürümlü rıza (Consent) tablosu.
-- Additive: yalnız YENİ enum/tablo/indeks/FK ekler; mevcut veriye DOKUNMAZ (veri kaybı yok).
-- kvkkConsentAt (User/Tenant) SİLİNMEZ — dual-write, geri alma yolu.
-- Neon shadow-DB uyumu: enum/FK için DO $$ + duplicate_object guard, tablo/indeks IF NOT EXISTS.
-- Uygulama (Tur B, PO onayı): `prisma db execute --file <bu dosya>` + ardından
--           `prisma migrate resolve --applied 20260828000000_add_consent`
-- (CLAUDE.md kuralı: `db push --accept-data-loss` YASAK; canlı=lokal DB → PO onayı ile.)

-- CreateEnum: ConsentType (duplicate_object guard)
DO $$ BEGIN
  CREATE TYPE "ConsentType" AS ENUM ('AYDINLATMA', 'ACIK_RIZA');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: ConsentSource (duplicate_object guard)
DO $$ BEGIN
  CREATE TYPE "ConsentSource" AS ENUM ('FORM', 'OAUTH', 'SELF_SERVE', 'BACKFILL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable: Consent
CREATE TABLE IF NOT EXISTS "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tenantId" TEXT,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "source" "ConsentSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Consent_userId_type_idx" ON "Consent"("userId", "type");
CREATE INDEX IF NOT EXISTS "Consent_tenantId_type_idx" ON "Consent"("tenantId", "type");

-- AddForeignKey: Consent.userId → User.id (idempotent guard)
DO $$ BEGIN
  ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey: Consent.tenantId → Tenant.id (idempotent guard)
DO $$ BEGIN
  ALTER TABLE "Consent" ADD CONSTRAINT "Consent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
