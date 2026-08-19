-- #37: Kurum (STK) başvurusu "düzeltme iste" akışı.
-- Additive + nullable → mevcut kayıtlar bozulmaz, veri kaybı yok. verificationNote EZİLMEZ.
-- Neon shadow-DB güvenli deseni: IF NOT EXISTS (db execute ile uygulanır, migrate resolve --applied).
-- NOT: enum ADD VALUE transaction dışında çalışmalı; db execute tek statement olarak uygular.
ALTER TYPE "TenantVerificationStatus" ADD VALUE IF NOT EXISTS 'CORRECTION_REQUESTED';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "correctionNote" TEXT;
