/**
 * AJ-77 (G6-02 / madde 49) — durum/tür alanlarının Zod şemaları, TEK KAYNAK: Prisma enum'ları.
 *
 * Neden: bu alanlar eskiden DB'de serbest metin (TEXT) idi; değer kümesi yalnız controller'lardaki elle
 * yazılmış `z.enum([...])` listelerinde yaşıyordu (şema yorumu ile kod ayrı ayrı güncelleniyordu).
 * Artık küme `prisma/schema.prisma` enum'unda; Zod onu buradan okur → DB, tip ve istek doğrulaması aynı kümeyi görür.
 * Yeni bir değer eklemek = şemada enum'a değer + migration (`ALTER TYPE ... ADD VALUE`), Zod kendiliğinden izler.
 *
 * DB/HTTP bağımlılığı YOK — birim testi doğrudan import eder (tests/aj77-status-enum.unit.test.ts).
 */
import { z } from 'zod';
import {
  CheckInConcernTag,
  CheckInContinuationView,
  CheckInContinueIntent,
  CheckInWantedMore,
  InvitationFormat,
  MeetingFormat,
  MeetingFrequency,
  MentorshipSide,
  ProgramTemplate,
  ReportingFrequency,
  TenantOnboardingStep,
  UserReportReason,
  UserReportStatus,
} from '@prisma/client';

// Tenant
export const onboardingStepSchema     = z.enum(TenantOnboardingStep);
export const programTemplateSchema    = z.enum(ProgramTemplate);
export const reportingFrequencySchema = z.enum(ReportingFrequency);

// MeetingCheckIn
export const continueIntentSchema   = z.enum(CheckInContinueIntent);
export const wantedMoreSchema       = z.enum(CheckInWantedMore);
export const concernTagSchema       = z.enum(CheckInConcernTag);
export const continuationViewSchema = z.enum(CheckInContinuationView);

// UserReport
export const userReportReasonSchema = z.enum(UserReportReason);
export const userReportStatusSchema = z.enum(UserReportStatus);
/** İnceleme sonucu: OPEN'a geri dönüş YOK (yalnız REVIEWED / DISMISSED). */
export const userReportReviewStatusSchema = userReportStatusSchema.exclude([UserReportStatus.OPEN]);

// MentorshipAgreement
export const meetingFrequencySchema     = z.enum(MeetingFrequency);
export const communicationChannelSchema = z.enum(MeetingFormat);
export const mentorshipSideSchema       = z.enum(MentorshipSide);

// InvitationTemplate (role → mentorshipSideSchema)
export const invitationFormatSchema = z.enum(InvitationFormat);
