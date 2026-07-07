-- Sprint 8: Kullanıcı onay sistemi (approvalStatus) + MatchRequest mesajı
-- Sprint 9: Şifre/auth alanları + RefreshToken tablosu
-- Sprint 10: PasswordResetToken tablosu

-- CreateEnum: Kullanıcı onay durumu
CREATE TYPE "UserApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable User: Sprint 8 alanları
ALTER TABLE "User"
  ADD COLUMN "approvalStatus" "UserApprovalStatus" NOT NULL DEFAULT 'APPROVED';

-- AlterTable User: Sprint 9 auth alanları
ALTER TABLE "User"
  ADD COLUMN "password"     TEXT,
  ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'LOCAL';

-- AlterTable User: email global unique (tenantId+email unique kaldırılır)
-- Eski unique constraint adı Prisma tarafından: "User_tenantId_email_key"
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_tenantId_email_key";
ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE ("email");

-- AlterTable MatchRequest: requestMessage alanı (Sprint 8)
ALTER TABLE "MatchRequest"
  ADD COLUMN "requestMessage" VARCHAR(1000);

-- CreateTable RefreshToken (Sprint 9)
CREATE TABLE "RefreshToken" (
  "id"        TEXT         NOT NULL,
  "token"     TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");
CREATE INDEX "RefreshToken_userId_idx"    ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable PasswordResetToken (Sprint 10)
CREATE TABLE "PasswordResetToken" (
  "id"        TEXT         NOT NULL,
  "tokenHash" TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx"    ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
