-- CreateTable: MeetingCheckIn (görüşme sonrası kısa değerlendirme)
CREATE TABLE "MeetingCheckIn" (
    "id"                 TEXT NOT NULL,
    "meetingId"          TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "role"               "UserRole" NOT NULL,
    "overallRating"      INTEGER NOT NULL,
    "progressRating"     INTEGER NOT NULL,
    "continueIntent"     TEXT NOT NULL,
    "menteePreparedness" INTEGER,
    "wantedMore"         TEXT,
    "nextTopicNote"      VARCHAR(500),
    "concernTag"         TEXT,
    "continuationView"   TEXT,
    "openNote"           VARCHAR(1000),
    "submittedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingCheckIn_pkey" PRIMARY KEY ("id")
);

-- AddColumns: Feedback model genişletme
ALTER TABLE "Feedback"
    ADD COLUMN "engagementScore"         INTEGER,
    ADD COLUMN "goalClarityScore"        INTEGER,
    ADD COLUMN "periodicCareerGrowth"    TEXT,
    ADD COLUMN "periodicTrustScore"      INTEGER,
    ADD COLUMN "periodicNetworkScore"    INTEGER,
    ADD COLUMN "periodicConfidenceScore" INTEGER,
    ADD COLUMN "periodicNpsScore"        INTEGER;

-- CreateIndexes
CREATE UNIQUE INDEX "MeetingCheckIn_meetingId_userId_key" ON "MeetingCheckIn"("meetingId", "userId");
CREATE INDEX "MeetingCheckIn_tenantId_idx"               ON "MeetingCheckIn"("tenantId");
CREATE INDEX "MeetingCheckIn_meetingId_idx"              ON "MeetingCheckIn"("meetingId");
CREATE INDEX "MeetingCheckIn_userId_idx"                 ON "MeetingCheckIn"("userId");
CREATE INDEX "MeetingCheckIn_tenantId_role_overall_idx"  ON "MeetingCheckIn"("tenantId", "role", "overallRating");

-- AddForeignKeys
ALTER TABLE "MeetingCheckIn"
    ADD CONSTRAINT "MeetingCheckIn_meetingId_fkey"
        FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MeetingCheckIn"
    ADD CONSTRAINT "MeetingCheckIn_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MeetingCheckIn"
    ADD CONSTRAINT "MeetingCheckIn_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
