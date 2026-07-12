-- CreateEnum: TenantVerificationStatus (IF NOT EXISTS guard)
DO $$ BEGIN
  CREATE TYPE "TenantVerificationStatus" AS ENUM ('AUTO_APPROVED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable: Tenant — kurum kayıt doğrulama alanları
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "verificationStatus" "TenantVerificationStatus" NOT NULL DEFAULT 'AUTO_APPROVED';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "verificationNote"   TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "verifiedAt"         TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "verifiedBy"         TEXT;
