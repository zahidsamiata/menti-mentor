-- U-13C (KARAR-83 C) — rol tarihçesi: RoleChange tablosu.
-- Additive: yalnız YENİ tablo + indeks + iki FK ekler; mevcut hiçbir tabloya/veriye DOKUNMAZ
-- (ALTER yok, backfill yok, veri kaybı yok). Yeni tablo boş başlar → yedek GEREKMEZ.
-- Geçmiş rol değişiklikleri bu tabloya TAŞINMAZ (kaynakları yalnız 90 günlük SystemLog); tarihçe EVET'ten sonra birikir.
-- Neon shadow-DB uyumu: tablo/indeks IF NOT EXISTS, FK DO $$ + duplicate_object guard (idempotent).
-- Uygulama: merge → Dockerfile açılışta `prisma migrate deploy` (PO "EVET"i sonrası; KARAR-145).
-- (CLAUDE.md kuralı: `db push --accept-data-loss` YASAK.)

-- CreateTable: RoleChange
CREATE TABLE IF NOT EXISTS "RoleChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousRole" "UserRole" NOT NULL,
    "newRole" "UserRole" NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: üyenin tarihçesi (tenantId + userId + createdAt sıralı okuma)
CREATE INDEX IF NOT EXISTS "RoleChange_tenantId_userId_createdAt_idx" ON "RoleChange"("tenantId", "userId", "createdAt");

-- AddForeignKey: RoleChange.tenantId → Tenant.id · RoleChange.userId → User.id (idempotent guard)
-- ON DELETE CASCADE: kurum ya da kişi silinirse tarihçesi de silinir (KVKK silme hakkı ile uyumlu).
DO $$ BEGIN
  ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RoleChange" ADD CONSTRAINT "RoleChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
