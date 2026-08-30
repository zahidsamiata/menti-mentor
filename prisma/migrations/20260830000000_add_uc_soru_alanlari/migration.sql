-- Üç soru (S1/S2/S3) veri alanları — değerlendirme tasarımı §10.2 (PO onaylı, 2026-08-30).
-- Additive + tümü opsiyonel/default boş → mevcut kayıtlar bozulmaz, veri kaybı YOK, backfill YOK.
-- Cevapsız = MEŞRU (kayıt akışını yarıda bırakan kullanıcı null/[] kalır).
-- interactionStyle DONDURULMUŞ — bu migration ona DOKUNMAZ (anılmaz).
-- Neon shadow-DB güvenli deseni: enum için DO $$ + duplicate_object guard; kolon için ADD COLUMN IF NOT EXISTS.
-- SQL idempotent (iki kez çalışsa da bozmaz). "≤2 seçim" kısıtı UYGULAMA katmanında — DB'de kısıt YOK.
-- Uygulama (Tur B, PO onayı): `prisma db execute --file <bu dosya>` + ardından
--           `prisma migrate resolve --applied 20260830000000_add_uc_soru_alanlari`
-- (CLAUDE.md: `db push --accept-data-loss` YASAK; canlı=lokal DB → PO onayı ile.)

-- CreateEnum: MentiNeed (S1 menti — ihtiyaç tipi)
DO $$ BEGIN
  CREATE TYPE "MentiNeed" AS ENUM ('KARAR_VEREMIYORUM', 'BECERIDE_TAKILDIM', 'GUVENMIYORUM', 'INSANLARI_TANIMIYORUM', 'KONUSACAK_BIRI');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum: MentorStrength (S1 mentör — fayda beyanı)
DO $$ BEGIN
  CREATE TYPE "MentorStrength" AS ENUM ('YON_BULMA', 'BECERI', 'OZGUVEN', 'AG_KURMA', 'DINLEME');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum: SupportApproach (S2 — yaklaşım hizası, her iki rol)
DO $$ BEGIN
  CREATE TYPE "SupportApproach" AS ENUM ('YOL_GOSTERME', 'BIRLIKTE_DUSUNME', 'DINLEME');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum: PriorityValue (S3 — değer yakınlığı, her iki rol)
DO $$ BEGIN
  CREATE TYPE "PriorityValue" AS ENUM ('RESULT', 'LEARNING', 'UNDERSTOOD', 'PERSPECTIVE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddColumn: User — dört yeni alan (hepsi opsiyonel/default boş, additive)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mentiNeeds" "MentiNeed"[] DEFAULT ARRAY[]::"MentiNeed"[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mentorStrengths" "MentorStrength"[] DEFAULT ARRAY[]::"MentorStrength"[];
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportApproach" "SupportApproach";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "priorityValue" "PriorityValue";
