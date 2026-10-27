-- U-12B (KARAR-82 B) — iptal edilebilir toplu davet bağlantısı: InvitationLink tablosu.
-- Additive: yalnız YENİ tablo + indeks + FK ekler; mevcut hiçbir tabloya/veriye DOKUNMAZ
-- (ALTER yok, backfill yok, veri kaybı yok). Yeni tablo boş başlar → yedek GEREKMEZ.
-- Neon shadow-DB uyumu: tablo/indeks IF NOT EXISTS, FK DO $$ + duplicate_object guard (idempotent).
-- Uygulama: merge → Dockerfile açılışta `prisma migrate deploy` (PO "EVET"i sonrası; KARAR-144).
-- (CLAUDE.md kuralı: `db push --accept-data-loss` YASAK.)

-- CreateTable: InvitationLink
CREATE TABLE IF NOT EXISTS "InvitationLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "InvitationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: kurumun bağlantı listesi (tenantId + createdAt sıralı okuma)
CREATE INDEX IF NOT EXISTS "InvitationLink_tenantId_createdAt_idx" ON "InvitationLink"("tenantId", "createdAt");

-- AddForeignKey: InvitationLink.tenantId → Tenant.id (idempotent guard)
-- ON DELETE CASCADE: kurum silinirse bağlantı kayıtları anlamsızdır, kurum silmeyi engellemesin.
DO $$ BEGIN
  ALTER TABLE "InvitationLink" ADD CONSTRAINT "InvitationLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
