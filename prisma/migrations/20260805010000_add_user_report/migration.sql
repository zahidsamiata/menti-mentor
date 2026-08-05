-- Kullanıcı şikayeti (UserReport): giriş yapmış kullanıcı → kullanıcı/durum şikayeti.
-- Tenant admin kendi kurumunun, platform admin tümünü görür. Additive: yeni tablo, veri kaybı yok.
-- IF NOT EXISTS: Neon shadow-DB güvenli, idempotent. Mevcut MentorshipAgreement deseniyle aynı stil.

CREATE TABLE IF NOT EXISTS "UserReport" (
  "id"             TEXT          NOT NULL,
  "tenantId"       TEXT          NOT NULL,
  "reporterUserId" TEXT          NOT NULL,
  "targetUserId"   TEXT          NOT NULL,
  "reason"         TEXT          NOT NULL,
  "description"    VARCHAR(1000),
  "status"         TEXT          NOT NULL DEFAULT 'OPEN',
  "reviewNote"     TEXT,
  "reviewedBy"     TEXT,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserReport_tenantId_idx"        ON "UserReport"("tenantId");
CREATE INDEX IF NOT EXISTS "UserReport_status_idx"          ON "UserReport"("status");
CREATE INDEX IF NOT EXISTS "UserReport_targetUserId_idx"    ON "UserReport"("targetUserId");
CREATE INDEX IF NOT EXISTS "UserReport_tenantId_status_idx" ON "UserReport"("tenantId", "status");
