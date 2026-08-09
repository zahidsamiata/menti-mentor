-- Chat v1 — menti↔mentör talep mesajlaşma (Conversation + Message)
-- Additive: yalnız YENİ tablo/indeks/FK ekler; mevcut veriye dokunmaz (veri kaybı yok).
-- Neon shadow-DB uyumu: IF NOT EXISTS + idempotent FK guard.
-- Uygulama: `prisma db execute --file <bu dosya>` + ardından
--           `prisma migrate resolve --applied 20260806000000_add_chat_conversation_message`
-- (CLAUDE.md kuralı: `db push --accept-data-loss` YASAK; canlı=lokal DB → PO onayı ile.)

-- CreateTable: Conversation
CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mentorUserId" TEXT NOT NULL,
    "mentiUserId" TEXT NOT NULL,
    "matchRequestId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mentorLastReadAt" TIMESTAMP(3),
    "mentiLastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Message
CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- Indexes: Conversation
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_mentorUserId_mentiUserId_key" ON "Conversation"("mentorUserId", "mentiUserId");
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_idx" ON "Conversation"("tenantId");
CREATE INDEX IF NOT EXISTS "Conversation_mentorUserId_idx" ON "Conversation"("mentorUserId");
CREATE INDEX IF NOT EXISTS "Conversation_mentiUserId_idx" ON "Conversation"("mentiUserId");

-- Indexes: Message
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_senderUserId_idx" ON "Message"("senderUserId");

-- Foreign Keys: Conversation (idempotent — duplicate_object yutulur)
DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_mentorUserId_fkey" FOREIGN KEY ("mentorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_mentiUserId_fkey" FOREIGN KEY ("mentiUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Foreign Keys: Message (idempotent)
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
