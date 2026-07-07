-- CreateEnum: QuestionCategory
CREATE TYPE "QuestionCategory" AS ENUM ('DISC_ASSESSMENT', 'STK_CUSTOM');

-- AddColumn: Question.category
ALTER TABLE "Question"
    ADD COLUMN "category" "QuestionCategory" NOT NULL DEFAULT 'DISC_ASSESSMENT';

-- Global sorular DISC_ASSESSMENT, tenant'a özel olanlar STK_CUSTOM varsayılan
UPDATE "Question" SET "category" = 'STK_CUSTOM' WHERE "tenantId" IS NOT NULL;
