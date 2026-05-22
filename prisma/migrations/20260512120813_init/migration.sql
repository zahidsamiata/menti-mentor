-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MENTOR', 'MENTI');

-- CreateEnum
CREATE TYPE "DiscType" AS ENUM ('D', 'I', 'S', 'C');

-- CreateEnum
CREATE TYPE "VisibilityOptInStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchTargetType" AS ENUM ('USER', 'JOB_LISTING');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isSharedPoolActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sectorTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discType" "DiscType",
    "temperamentJson" JSONB,
    "volunteerHistory" JSONB,
    "pastProjects" JSONB,
    "education" JSONB,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisibilityOptIn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "mentiId" TEXT NOT NULL,
    "status" "VisibilityOptInStatus" NOT NULL DEFAULT 'PENDING',
    "iceBreaker" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisibilityOptIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "targetType" "MatchTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobListing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "VisibilityOptIn_tenantId_idx" ON "VisibilityOptIn"("tenantId");

-- CreateIndex
CREATE INDEX "VisibilityOptIn_mentorId_idx" ON "VisibilityOptIn"("mentorId");

-- CreateIndex
CREATE INDEX "VisibilityOptIn_mentiId_idx" ON "VisibilityOptIn"("mentiId");

-- CreateIndex
CREATE UNIQUE INDEX "VisibilityOptIn_mentorId_mentiId_key" ON "VisibilityOptIn"("mentorId", "mentiId");

-- CreateIndex
CREATE INDEX "MatchRequest_tenantId_idx" ON "MatchRequest"("tenantId");

-- CreateIndex
CREATE INDEX "MatchRequest_requesterUserId_idx" ON "MatchRequest"("requesterUserId");

-- CreateIndex
CREATE INDEX "MatchRequest_targetType_targetId_idx" ON "MatchRequest"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "JobListing_tenantId_idx" ON "JobListing"("tenantId");

-- CreateIndex
CREATE INDEX "JobListing_isActive_idx" ON "JobListing"("isActive");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityOptIn" ADD CONSTRAINT "VisibilityOptIn_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityOptIn" ADD CONSTRAINT "VisibilityOptIn_mentiId_fkey" FOREIGN KEY ("mentiId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisibilityOptIn" ADD CONSTRAINT "VisibilityOptIn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRequest" ADD CONSTRAINT "MatchRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRequest" ADD CONSTRAINT "MatchRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobListing" ADD CONSTRAINT "JobListing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
