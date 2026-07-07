-- AddColumn: Question.isRequired ve updatedAt
ALTER TABLE "Question"
    ADD COLUMN "isRequired" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable: QuestionHide (global soru gizleme — silme değil)
CREATE TABLE "QuestionHide" (
    "id"         TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "hiddenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionHide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionHide_questionId_tenantId_key" ON "QuestionHide"("questionId", "tenantId");
CREATE INDEX "QuestionHide_tenantId_idx" ON "QuestionHide"("tenantId");

ALTER TABLE "QuestionHide"
    ADD CONSTRAINT "QuestionHide_questionId_fkey"
        FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionHide"
    ADD CONSTRAINT "QuestionHide_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
