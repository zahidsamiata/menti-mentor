-- Sprint 14: Taxonomy yönetimi için PendingTag modeli
-- Kullanıcıların önerdiği özel etiketlerin admin onay kuyruğu

-- CreateEnum
CREATE TYPE "PendingTagStatus" AS ENUM ('PENDING', 'APPROVED', 'MERGED', 'REJECTED');

-- CreateTable
CREATE TABLE "PendingTag" (
  "id"          TEXT             NOT NULL,
  "tenantId"    TEXT             NOT NULL,
  "value"       TEXT             NOT NULL,
  "submittedBy" TEXT             NOT NULL,
  "status"      "PendingTagStatus" NOT NULL DEFAULT 'PENDING',
  "mergedInto"  TEXT,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "PendingTag_pkey" PRIMARY KEY ("id")
);

-- Unique: bir tenant içinde aynı etiket değeri bir kez bekleyebilir
CREATE UNIQUE INDEX "PendingTag_tenantId_value_key" ON "PendingTag"("tenantId", "value");
CREATE INDEX "PendingTag_tenantId_status_idx" ON "PendingTag"("tenantId", "status");
CREATE INDEX "PendingTag_submittedBy_idx"     ON "PendingTag"("submittedBy");

-- Foreign keys
ALTER TABLE "PendingTag"
  ADD CONSTRAINT "PendingTag_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PendingTag"
  ADD CONSTRAINT "PendingTag_submittedBy_fkey"
  FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
