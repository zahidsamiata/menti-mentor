-- Admin Settings & Super Admin Migration
-- Adds tenant program rules, blocked-pairs store, and isActive flag

-- AlterTable: Tenant — program kuralları
ALTER TABLE "Tenant" ADD COLUMN "maxMeetingsPerWeek"     INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Tenant" ADD COLUMN "minMatchScoreThreshold" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Tenant" ADD COLUMN "blockedPairs"           JSONB;
ALTER TABLE "Tenant" ADD COLUMN "isActive"               BOOLEAN NOT NULL DEFAULT true;
