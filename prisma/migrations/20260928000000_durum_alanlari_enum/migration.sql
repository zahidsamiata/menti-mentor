-- AJ-77 (G6-02 / madde 49): serbest metin (TEXT) durum/tür alanları → Postgres ENUM.
-- Kapsam: 13 kolon / 5 tablo — yalnız kodda değer kümesi KAPALI olanlar (her yazma yolu Zod enum'dan geçiyor).
--   Tenant.onboardingStep · Tenant.programTemplate · Tenant.reportingFrequency
--   MeetingCheckIn.continueIntent · .wantedMore · .concernTag · .continuationView
--   UserReport.reason · UserReport.status
--   MentorshipAgreement.meetingFrequency · .communicationChannel (mevcut "MeetingFormat") · .agendaOwner
--   InvitationTemplate.role · InvitationTemplate.format
-- KAPSAM DIŞI (bilerek): Tenant.plan (kodda yalnız 'FREE' yazılıyor, paket kümesi ürün kararı) ·
--   SystemLog.category (kod 'AUDIT' yazıyor, şema yorumu/filtre bilmiyor → önce temizlik) · User.authProvider vb.
--   Envanter: çatı docs/raporlar/kod-denetimi/aj77-durum-alanlari-envanter-2026-09-28.md
--
-- Veri kaybı YOK: Prisma'nın ürettiği DROP COLUMN + ADD COLUMN yerine ALTER COLUMN ... TYPE ... USING.
-- Varsayılan değerli kolonlarda önce DROP DEFAULT (TEXT varsayılanı enum'a otomatik dönüşmez), sonra SET DEFAULT.
-- İndeksler (UserReport_status_idx · UserReport_tenantId_status_idx · InvitationTemplate_tenantId_role_format_key)
--   ALTER TYPE sırasında Postgres tarafından AYNI adla yeniden kurulur — ayrıca CREATE INDEX gerekmez.
--
-- ⚠️ GEÇERSİZ DEĞER KORUMASI: kümeye uymayan tek bir canlı değer varsa aşağıdaki DO bloğu
--   RAISE EXCEPTION ile TÜM betiği durdurur (çok ifadeli betik tek örtük işlemde koşar → hiçbir şey değişmez).
--   Dockerfile açılışta `migrate deploy` çalıştırdığı için bu durumda KONTEYNER AÇILMAZ.
--   Bu yüzden merge ÖNCESİ PR'daki sayım sorguları çalıştırılır; geçersiz sayısı 0 değilse merge EDİLMEZ.
--
-- Neon shadow-DB güvenli deseni: enum için DO $$ + duplicate_object guard; ALTER ... USING "<kolon>"::text::"<Enum>"
--   iki kez çalışsa da bozmaz (enum → text → aynı enum).
-- ⚠️ BU TUR ÇALIŞTIRILMADI — yalnız dosya üretildi. Uygulama (PO EVET + tarihli yedek sonrası):
--   `prisma db execute --file prisma/migrations/20260928000000_durum_alanlari_enum/migration.sql`
--   + ardından `prisma migrate resolve --applied 20260928000000_durum_alanlari_enum`
-- (CLAUDE.md Migration Kuralı: `db push --accept-data-loss` YASAK.)

-- ─── 1) Enum tipleri ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "TenantOnboardingStep" AS ENUM ('PENDING', 'TEMPLATE', 'LOGO', 'PREVIEW', 'DONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ProgramTemplate" AS ENUM ('MEZUN', 'KULUP', 'GONULLU', 'OZEL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReportingFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CheckInContinueIntent" AS ENUM ('EVET', 'BELIRSIZ', 'HAYIR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CheckInWantedMore" AS ENUM ('YONLENDIRME', 'KAYNAK', 'BAGLANIT', 'GERI_BILDIRIM', 'HAYIR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CheckInConcernTag" AS ENUM ('MOT_DUSUK', 'HEDEF_BELIRSIZ', 'ZAMAN_YOK', 'ILETISIM', 'HAYIR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CheckInContinuationView" AS ENUM ('KESINLIKLE', 'EVET', 'KARARSIZ', 'HAYIR');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "UserReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'NO_SHOW', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "UserReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MeetingFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "MentorshipSide" AS ENUM ('MENTOR', 'MENTI');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InvitationFormat" AS ENUM ('EMAIL', 'WHATSAPP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── 2) Geçersiz değer koruması (izin verilen küme = enum_range; değer listesi tekrar yazılmaz) ───
DO $$
DECLARE
  bad bigint;
  report text := '';
BEGIN
  SELECT count(*) INTO bad FROM "Tenant" WHERE NOT ("onboardingStep"::text = ANY (enum_range(NULL::"TenantOnboardingStep")::text[]));
  IF bad > 0 THEN report := report || format(' Tenant.onboardingStep=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "Tenant" WHERE "programTemplate" IS NOT NULL AND NOT ("programTemplate"::text = ANY (enum_range(NULL::"ProgramTemplate")::text[]));
  IF bad > 0 THEN report := report || format(' Tenant.programTemplate=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "Tenant" WHERE NOT ("reportingFrequency"::text = ANY (enum_range(NULL::"ReportingFrequency")::text[]));
  IF bad > 0 THEN report := report || format(' Tenant.reportingFrequency=%s', bad); END IF;

  SELECT count(*) INTO bad FROM "MeetingCheckIn" WHERE NOT ("continueIntent"::text = ANY (enum_range(NULL::"CheckInContinueIntent")::text[]));
  IF bad > 0 THEN report := report || format(' MeetingCheckIn.continueIntent=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "MeetingCheckIn" WHERE "wantedMore" IS NOT NULL AND NOT ("wantedMore"::text = ANY (enum_range(NULL::"CheckInWantedMore")::text[]));
  IF bad > 0 THEN report := report || format(' MeetingCheckIn.wantedMore=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "MeetingCheckIn" WHERE "concernTag" IS NOT NULL AND NOT ("concernTag"::text = ANY (enum_range(NULL::"CheckInConcernTag")::text[]));
  IF bad > 0 THEN report := report || format(' MeetingCheckIn.concernTag=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "MeetingCheckIn" WHERE "continuationView" IS NOT NULL AND NOT ("continuationView"::text = ANY (enum_range(NULL::"CheckInContinuationView")::text[]));
  IF bad > 0 THEN report := report || format(' MeetingCheckIn.continuationView=%s', bad); END IF;

  SELECT count(*) INTO bad FROM "UserReport" WHERE NOT ("reason"::text = ANY (enum_range(NULL::"UserReportReason")::text[]));
  IF bad > 0 THEN report := report || format(' UserReport.reason=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "UserReport" WHERE NOT ("status"::text = ANY (enum_range(NULL::"UserReportStatus")::text[]));
  IF bad > 0 THEN report := report || format(' UserReport.status=%s', bad); END IF;

  SELECT count(*) INTO bad FROM "MentorshipAgreement" WHERE NOT ("meetingFrequency"::text = ANY (enum_range(NULL::"MeetingFrequency")::text[]));
  IF bad > 0 THEN report := report || format(' MentorshipAgreement.meetingFrequency=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "MentorshipAgreement" WHERE NOT ("communicationChannel"::text = ANY (enum_range(NULL::"MeetingFormat")::text[]));
  IF bad > 0 THEN report := report || format(' MentorshipAgreement.communicationChannel=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "MentorshipAgreement" WHERE NOT ("agendaOwner"::text = ANY (enum_range(NULL::"MentorshipSide")::text[]));
  IF bad > 0 THEN report := report || format(' MentorshipAgreement.agendaOwner=%s', bad); END IF;

  SELECT count(*) INTO bad FROM "InvitationTemplate" WHERE NOT ("role"::text = ANY (enum_range(NULL::"MentorshipSide")::text[]));
  IF bad > 0 THEN report := report || format(' InvitationTemplate.role=%s', bad); END IF;
  SELECT count(*) INTO bad FROM "InvitationTemplate" WHERE NOT ("format"::text = ANY (enum_range(NULL::"InvitationFormat")::text[]));
  IF bad > 0 THEN report := report || format(' InvitationTemplate.format=%s', bad); END IF;

  IF report <> '' THEN
    RAISE EXCEPTION 'AJ-77: enum kümesine uymayan canlı değer var, hiçbir kolon değiştirilmedi:%', report;
  END IF;
END $$;

-- ─── 3) Kolon tipleri (veri korunur) ─────────────────────────────────────────
-- Tenant
ALTER TABLE "Tenant" ALTER COLUMN "onboardingStep" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "onboardingStep" TYPE "TenantOnboardingStep" USING ("onboardingStep"::text::"TenantOnboardingStep");
ALTER TABLE "Tenant" ALTER COLUMN "onboardingStep" SET DEFAULT 'PENDING';
ALTER TABLE "Tenant" ALTER COLUMN "programTemplate" TYPE "ProgramTemplate" USING ("programTemplate"::text::"ProgramTemplate");
ALTER TABLE "Tenant" ALTER COLUMN "reportingFrequency" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "reportingFrequency" TYPE "ReportingFrequency" USING ("reportingFrequency"::text::"ReportingFrequency");
ALTER TABLE "Tenant" ALTER COLUMN "reportingFrequency" SET DEFAULT 'WEEKLY';

-- MeetingCheckIn
ALTER TABLE "MeetingCheckIn" ALTER COLUMN "continueIntent" TYPE "CheckInContinueIntent" USING ("continueIntent"::text::"CheckInContinueIntent");
ALTER TABLE "MeetingCheckIn" ALTER COLUMN "wantedMore" TYPE "CheckInWantedMore" USING ("wantedMore"::text::"CheckInWantedMore");
ALTER TABLE "MeetingCheckIn" ALTER COLUMN "concernTag" TYPE "CheckInConcernTag" USING ("concernTag"::text::"CheckInConcernTag");
ALTER TABLE "MeetingCheckIn" ALTER COLUMN "continuationView" TYPE "CheckInContinuationView" USING ("continuationView"::text::"CheckInContinuationView");

-- UserReport
ALTER TABLE "UserReport" ALTER COLUMN "reason" TYPE "UserReportReason" USING ("reason"::text::"UserReportReason");
ALTER TABLE "UserReport" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "UserReport" ALTER COLUMN "status" TYPE "UserReportStatus" USING ("status"::text::"UserReportStatus");
ALTER TABLE "UserReport" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- MentorshipAgreement
ALTER TABLE "MentorshipAgreement" ALTER COLUMN "meetingFrequency" TYPE "MeetingFrequency" USING ("meetingFrequency"::text::"MeetingFrequency");
ALTER TABLE "MentorshipAgreement" ALTER COLUMN "communicationChannel" TYPE "MeetingFormat" USING ("communicationChannel"::text::"MeetingFormat");
ALTER TABLE "MentorshipAgreement" ALTER COLUMN "agendaOwner" DROP DEFAULT;
ALTER TABLE "MentorshipAgreement" ALTER COLUMN "agendaOwner" TYPE "MentorshipSide" USING ("agendaOwner"::text::"MentorshipSide");
ALTER TABLE "MentorshipAgreement" ALTER COLUMN "agendaOwner" SET DEFAULT 'MENTI';

-- InvitationTemplate
ALTER TABLE "InvitationTemplate" ALTER COLUMN "role" TYPE "MentorshipSide" USING ("role"::text::"MentorshipSide");
ALTER TABLE "InvitationTemplate" ALTER COLUMN "format" TYPE "InvitationFormat" USING ("format"::text::"InvitationFormat");
