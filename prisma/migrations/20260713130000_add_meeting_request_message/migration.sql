-- AlterTable: Meeting — niyet mesajı alanı eklendi
ALTER TABLE "Meeting" ADD COLUMN IF NOT EXISTS "requestMessage" VARCHAR(500);
