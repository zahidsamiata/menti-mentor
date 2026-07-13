-- AgreementStatus enum
DO $$ BEGIN
  CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RENEWAL_PENDING', 'RENEWED', 'ENDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- MentorshipAgreement tablosu
CREATE TABLE IF NOT EXISTS "MentorshipAgreement" (
  "id"                   TEXT             NOT NULL,
  "tenantId"             TEXT             NOT NULL,
  "mentorId"             TEXT             NOT NULL,
  "mentiId"              TEXT             NOT NULL,
  "matchId"              TEXT,
  "meetingFrequency"     TEXT             NOT NULL,
  "communicationChannel" TEXT             NOT NULL,
  "durationWeeks"        INTEGER          NOT NULL,
  "targetMeetings"       INTEGER          NOT NULL,
  "mentiGoal"            VARCHAR(1000)    NOT NULL,
  "agendaOwner"          TEXT             NOT NULL DEFAULT 'MENTI',
  "privacyAgreed"        BOOLEAN          NOT NULL DEFAULT false,
  "mentorConfirmedAt"    TIMESTAMP(3),
  "mentiConfirmedAt"     TIMESTAMP(3),
  "status"               "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "renewalAskedAt"       TIMESTAMP(3),
  "expiresAt"            TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MentorshipAgreement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MentorshipAgreement_tenantId_idx"        ON "MentorshipAgreement"("tenantId");
CREATE INDEX IF NOT EXISTS "MentorshipAgreement_mentorId_idx"         ON "MentorshipAgreement"("mentorId");
CREATE INDEX IF NOT EXISTS "MentorshipAgreement_mentiId_idx"          ON "MentorshipAgreement"("mentiId");
CREATE INDEX IF NOT EXISTS "MentorshipAgreement_status_idx"           ON "MentorshipAgreement"("status");
CREATE INDEX IF NOT EXISTS "MentorshipAgreement_tenantId_status_idx"  ON "MentorshipAgreement"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "MentorshipAgreement_expiresAt_status_idx" ON "MentorshipAgreement"("expiresAt", "status");
