-- User sosyal profil alanları
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl"    TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "linkedinUrl"  TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "instagramUrl" TEXT;

-- Şüphe bildirimleri tablosu
CREATE TABLE IF NOT EXISTS "SuspicionReport" (
  "id"           TEXT        NOT NULL,
  "tenantName"   TEXT        NOT NULL,
  "reporterName" TEXT        NOT NULL,
  "reporterRole" TEXT        NOT NULL,
  "contact"      TEXT        NOT NULL,
  "description"  TEXT        NOT NULL,
  "reviewed"     BOOLEAN     NOT NULL DEFAULT false,
  "reviewNote"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuspicionReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SuspicionReport_reviewed_idx" ON "SuspicionReport"("reviewed");

-- Davet şablonu tablosu
CREATE TABLE IF NOT EXISTS "InvitationTemplate" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "role"      TEXT         NOT NULL,
  "format"    TEXT         NOT NULL,
  "content"   TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvitationTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvitationTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InvitationTemplate_tenantId_role_format_key" ON "InvitationTemplate"("tenantId", "role", "format");
CREATE INDEX IF NOT EXISTS "InvitationTemplate_tenantId_idx" ON "InvitationTemplate"("tenantId");
