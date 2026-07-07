-- AddColumn: discAssessmentCompletedAt on User
ALTER TABLE "User" ADD COLUMN "discAssessmentCompletedAt" TIMESTAMP(3);

-- CreateTable: MentorFilter
CREATE TABLE "MentorFilter" (
    "id" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "minCompatibilityScore" INTEGER NOT NULL DEFAULT 0,
    "blockedDiscTypes" "DiscType"[] DEFAULT ARRAY[]::"DiscType"[],
    "filterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentorFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MentorFilter_mentorId_key" ON "MentorFilter"("mentorId");

-- AddForeignKey
ALTER TABLE "MentorFilter" ADD CONSTRAINT "MentorFilter_mentorId_fkey"
    FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
