-- AddColumn: Tenant.reportingFrequency (AlgorithmTuner bildirim sıklığı)
ALTER TABLE "Tenant" ADD COLUMN "reportingFrequency" TEXT NOT NULL DEFAULT 'WEEKLY';
