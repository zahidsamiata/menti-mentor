-- PLG / Freemium Architecture Migration
-- Adds tenant plan/onboarding fields and user visibility/DISC result card fields

-- AlterTable: Tenant — PLG katmanı
ALTER TABLE "Tenant" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "Tenant" ADD COLUMN "limits" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "onboardingStep" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Tenant" ADD COLUMN "programTemplate" TEXT;

-- AlterTable: User — PLG üye alanları
ALTER TABLE "User" ADD COLUMN "mentorVisibilityEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "discResultCard" JSONB;
