/**
 * AJ-77 (G6-02 / madde 49) — durum/tür alanları enum'a çevrildi: geçersiz değer yazımı
 * Zod seviyesinde ve TİP seviyesinde reddedilir. Birim testi, DB gerektirmez.
 *
 * Ölçtüğü şey:
 *  1. Her alanın kabul edilen kümesi = Prisma enum'u = migration öncesi koddaki Zod listesi (dondurulmuş beklenti).
 *     Şema alanı String'e geri dönerse Prisma enum export'u kaybolur → bu dosya kırmızı olur.
 *  2. Kümeye uymayan (yazım hatalı / küçük harf / boş) değer reddedilir.
 *  3. Prisma yazma girdisi tipi (`Prisma.*CreateInput`) serbest metni kabul etmez (`@ts-expect-error`
 *     → alan String'e dönerse tsc -p tsconfig.test.json kırmızı).
 *
 * Tek başına koşum: npx vitest run tests/aj77-status-enum.unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  CheckInConcernTag,
  CheckInContinuationView,
  CheckInContinueIntent,
  CheckInWantedMore,
  InvitationFormat,
  MeetingFrequency,
  MentorshipSide,
  ProgramTemplate,
  ReportingFrequency,
  TenantOnboardingStep,
  UserReportReason,
  UserReportStatus,
} from '@prisma/client';
import type { ZodType } from 'zod';
import {
  communicationChannelSchema,
  concernTagSchema,
  continuationViewSchema,
  continueIntentSchema,
  invitationFormatSchema,
  meetingFrequencySchema,
  mentorshipSideSchema,
  onboardingStepSchema,
  programTemplateSchema,
  reportingFrequencySchema,
  userReportReasonSchema,
  userReportReviewStatusSchema,
  userReportStatusSchema,
  wantedMoreSchema,
} from '../src/services/statusFieldSchemas.js';

type Case = { field: string; prismaEnum: Record<string, string> | undefined; schema: ZodType; expected: string[] };

// Beklenen kümeler: migration ÖNCESİ controller'lardaki z.enum([...]) listeleri ve şema yorumlarıyla birebir.
const CASES: Case[] = [
  { field: 'Tenant.onboardingStep', prismaEnum: TenantOnboardingStep, schema: onboardingStepSchema, expected: ['PENDING', 'TEMPLATE', 'LOGO', 'PREVIEW', 'DONE'] },
  { field: 'Tenant.programTemplate', prismaEnum: ProgramTemplate, schema: programTemplateSchema, expected: ['MEZUN', 'KULUP', 'GONULLU', 'OZEL'] },
  { field: 'Tenant.reportingFrequency', prismaEnum: ReportingFrequency, schema: reportingFrequencySchema, expected: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] },
  { field: 'MeetingCheckIn.continueIntent', prismaEnum: CheckInContinueIntent, schema: continueIntentSchema, expected: ['EVET', 'BELIRSIZ', 'HAYIR'] },
  { field: 'MeetingCheckIn.wantedMore', prismaEnum: CheckInWantedMore, schema: wantedMoreSchema, expected: ['YONLENDIRME', 'KAYNAK', 'BAGLANIT', 'GERI_BILDIRIM', 'HAYIR'] },
  { field: 'MeetingCheckIn.concernTag', prismaEnum: CheckInConcernTag, schema: concernTagSchema, expected: ['MOT_DUSUK', 'HEDEF_BELIRSIZ', 'ZAMAN_YOK', 'ILETISIM', 'HAYIR'] },
  { field: 'MeetingCheckIn.continuationView', prismaEnum: CheckInContinuationView, schema: continuationViewSchema, expected: ['KESINLIKLE', 'EVET', 'KARARSIZ', 'HAYIR'] },
  { field: 'UserReport.reason', prismaEnum: UserReportReason, schema: userReportReasonSchema, expected: ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'NO_SHOW', 'OTHER'] },
  { field: 'UserReport.status', prismaEnum: UserReportStatus, schema: userReportStatusSchema, expected: ['OPEN', 'REVIEWED', 'DISMISSED'] },
  { field: 'MentorshipAgreement.meetingFrequency', prismaEnum: MeetingFrequency, schema: meetingFrequencySchema, expected: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] },
  { field: 'MentorshipAgreement.agendaOwner / InvitationTemplate.role', prismaEnum: MentorshipSide, schema: mentorshipSideSchema, expected: ['MENTOR', 'MENTI'] },
  { field: 'InvitationTemplate.format', prismaEnum: InvitationFormat, schema: invitationFormatSchema, expected: ['EMAIL', 'WHATSAPP'] },
];

describe('AJ-77 — durum alanlarının kümesi Prisma enum\'undan gelir', () => {
  it.each(CASES)('$field: Prisma enum var ve kümesi beklenenle birebir', ({ prismaEnum, expected }) => {
    expect(prismaEnum, 'Prisma enum export\'u yok — alan String\'e mi döndü?').toBeDefined();
    expect(Object.values(prismaEnum ?? {}).sort()).toEqual([...expected].sort());
  });

  it.each(CASES)('$field: kümedeki her değer kabul edilir', ({ schema, expected }) => {
    for (const value of expected) expect(schema.safeParse(value).success, value).toBe(true);
  });

  it.each(CASES)('$field: kümeye uymayan değer reddedilir', ({ schema, expected }) => {
    const invalid = ['GECERSIZ', '', expected[0]!.toLowerCase(), ` ${expected[0]}`];
    for (const value of invalid) expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it('MentorshipAgreement.communicationChannel mevcut MeetingFormat kümesini kullanır', () => {
    for (const value of ['ONLINE', 'IN_PERSON', 'PHONE']) expect(communicationChannelSchema.safeParse(value).success).toBe(true);
    expect(communicationChannelSchema.safeParse('EMAIL').success).toBe(false);
  });

  it('MentorshipSide, UserRole\'ün geniş değerlerini (ADMIN) kabul etmez', () => {
    expect(mentorshipSideSchema.safeParse('ADMIN').success).toBe(false);
  });

  it('şikayet incelemesi OPEN\'a geri döndüremez', () => {
    expect(userReportReviewStatusSchema.safeParse('OPEN').success).toBe(false);
    expect(userReportReviewStatusSchema.safeParse('REVIEWED').success).toBe(true);
    expect(userReportReviewStatusSchema.safeParse('DISMISSED').success).toBe(true);
  });
});

describe('AJ-77 — Prisma yazma tipleri serbest metni kabul etmez (tsc -p tsconfig.test.json ölçer)', () => {
  it('geçersiz literal değerler derleme hatasıdır', () => {
    // Her @ts-expect-error: alan enum iken hata BEKLENİR; alan String'e dönerse satır "kullanılmayan
    // ts-expect-error" olur ve tsc kırmızıya düşer. Çalışma zamanında yalnız nesne kurulur, DB'ye gitmez.
    const report: Partial<Prisma.UserReportUncheckedCreateInput> = {
      // @ts-expect-error — UserReportReason dışında değer
      reason: 'SPAM_TYPO',
      // @ts-expect-error — UserReportStatus dışında değer
      status: 'CLOSED',
    };
    const template: Partial<Prisma.InvitationTemplateUncheckedCreateInput> = {
      // @ts-expect-error — MentorshipSide dışında değer
      role: 'ADMIN',
      // @ts-expect-error — InvitationFormat dışında değer
      format: 'SMS',
    };
    const tenant: Partial<Prisma.TenantUncheckedCreateInput> = {
      // @ts-expect-error — TenantOnboardingStep dışında değer
      onboardingStep: 'FINISHED',
      // @ts-expect-error — ReportingFrequency dışında değer
      reportingFrequency: 'DAILY',
      // @ts-expect-error — ProgramTemplate dışında değer
      programTemplate: 'DIGER',
    };
    const checkIn: Partial<Prisma.MeetingCheckInUncheckedCreateInput> = {
      // @ts-expect-error — CheckInContinueIntent dışında değer
      continueIntent: 'BELKI',
      // @ts-expect-error — CheckInWantedMore dışında değer
      wantedMore: 'PARA',
      // @ts-expect-error — CheckInConcernTag dışında değer
      concernTag: 'YOK',
      // @ts-expect-error — CheckInContinuationView dışında değer
      continuationView: 'ASLA',
    };
    const agreement: Partial<Prisma.MentorshipAgreementUncheckedCreateInput> = {
      // @ts-expect-error — MeetingFrequency dışında değer
      meetingFrequency: 'DAILY',
      // @ts-expect-error — MeetingFormat dışında değer
      communicationChannel: 'EMAIL',
      // @ts-expect-error — MentorshipSide dışında değer
      agendaOwner: 'ADMIN',
    };
    expect([report, template, tenant, checkIn, agreement]).toHaveLength(5);
  });
});
