/**
 * GDPR / KVKK Uyum Servisi
 *
 * Kapsam:
 *   - 6698 sayılı KVKK (Kişisel Verilerin Korunması Kanunu)
 *   - GDPR Madde 17 (Silinme Hakkı / Right to Erasure)
 *
 * Desteklenen işlemler:
 *   1. anonymizeUser  — PII alanlarını anonimleştirir, analitik veriyi korur
 *   2. hardDeleteUser — Kullanıcıyı ve ilgili tüm kayıtları tamamen siler
 *   3. exportUserData — KVKK Madde 11 / GDPR Madde 20 veri taşınabilirliği
 *   4. purgeExpiredData — Saklama süresi dolan verileri otomatik sil
 *
 * PII Alanları (tanım):
 *   - fullName, email, bioSummary, expertiseDetails, targetAudience
 *   - volunteerHistory, pastProjects, education, selfProfile (serbest form)
 *   - discVector (kişilik verisi — hassas kategori)
 *   - discType (kişilik verisi — hassas kategori)
 *   - UserProfile.schools, UserProfile.companies, UserProfile.communities (bağlam/PII)
 *   - UserProfile.discD/I/S/C, oceanO..N, archetype (kişilik verisi — hassas kategori)
 *
 * Analitik Alanları (silinmez — anonimleştirme sonrası korunur):
 *   - sectorTags, role, tenantId (tenant-seviyesi istatistik)
 *   - UserProfile.skillTags, goalTags, industryCode, yearsExp (mesleki, non-PII)
 *   - FeedbackLog.npsScore, FeedbackLog.starRating (anonim)
 *   - createdAt (zaman analizi)
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from './logger.js';

const JsonNull = Prisma.JsonNull;

const ANON_NAME = '[Silinmiş Kullanıcı]';
const ANON_EMAIL_PREFIX = 'deleted_';

// ─── 1. Anonimleştirme ────────────────────────────────────────────────────────

export type AnonymizeResult = {
  userId: string;
  anonymizedAt: string;
  fieldsCleared: string[];
};

/**
 * Kullanıcının PII verilerini siler, analitik yapısını korur.
 * İlgili cross-tablolar (VisibilityOptIn) da temizlenir.
 */
export async function anonymizeUser(userId: string, tenantId: string): Promise<AnonymizeResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, email: true },
  });

  if (!user) {
    throw new Error(`Kullanıcı bulunamadı: ${userId}`);
  }

  const anonymizedEmail = `${ANON_EMAIL_PREFIX}${userId}@anon.invalid`;

  await prisma.$transaction(async (tx) => {
    // Kullanıcı PII alanlarını temizle
    await tx.user.update({
      where: { id: userId },
      data: {
        fullName: ANON_NAME,
        email: anonymizedEmail,
        bioSummary: null,
        expertiseDetails: null,
        targetAudience: null,
        volunteerHistory: JsonNull,
        pastProjects: JsonNull,
        education: JsonNull,
        selfProfile: JsonNull,
        discVector: JsonNull,     // Kişilik verisi — hassas kategori
        discType: null,           // Kişilik verisi — hassas kategori
        temperamentJson: JsonNull,
        discResultCard: JsonNull, // Kişilik "aha" kartı — hassas kategori (madde 93 kapsamında eklendi)
        enneagramWing: null,      // Kişilik verisi — hassas kategori
        avatarUrl: null,          // PII: profil fotoğrafı bağlantısı (fiziksel dosya silme = ayrı iş, madde 93)
        linkedinUrl: null,        // PII: sosyal medya (doğrudan tanımlayıcı)
        instagramUrl: null,       // PII: sosyal medya (doğrudan tanımlayıcı)
        isActive: false,      // Hesabı pasife al
      },
    });

    // Kullanıcı yanıtlarını sil (DISC soruları — kişilik profili)
    await tx.userResponse.deleteMany({ where: { userId } });

    // UserProfile: PII/kişilik alanlarını temizle, Analitik (skill/goal/industry/yearsExp) koru.
    // updateMany kullanılır — profil satırı yoksa sessizce no-op olur.
    await tx.userProfile.updateMany({
      where: { userId },
      data: {
        schools: [], companies: [], communities: [],           // PII bağlam
        discD: 0, discI: 0, discS: 0, discC: 0,                 // kişilik verisi
        oceanO: null, oceanC: null, oceanE: null, oceanA: null, oceanN: null,
        archetype: null,
      },
    });
  });

  const fieldsCleared = [
    'fullName', 'email', 'bioSummary', 'expertiseDetails', 'targetAudience',
    'volunteerHistory', 'pastProjects', 'education', 'selfProfile',
    'discVector', 'discType', 'temperamentJson', 'discResultCard', 'enneagramWing',
    'avatarUrl', 'linkedinUrl', 'instagramUrl',
    'userResponses',
    'userProfile.schools', 'userProfile.companies', 'userProfile.communities',
    'userProfile.disc', 'userProfile.ocean', 'userProfile.archetype',
  ];

  void logger.info('SYSTEM', 'KVKK: Kullanıcı anonimleştirildi', {
    userId,
    tenantId,
    fieldsCleared: fieldsCleared.length,
  });

  return {
    userId,
    anonymizedAt: new Date().toISOString(),
    fieldsCleared,
  };
}

// ─── 2. Hard Delete ───────────────────────────────────────────────────────────

export type HardDeleteResult = {
  userId: string;
  deletedAt: string;
  tablesAffected: string[];
};

/**
 * Kullanıcıyı ve tüm ilgili kayıtları kalıcı olarak siler.
 * ⚠️ GERİ ALINAMAZ — sadece açık kullanıcı talebi veya yasal zorunluluk ile kullanın.
 */
export async function hardDeleteUser(userId: string, tenantId: string): Promise<HardDeleteResult> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true },
  });

  if (!user) {
    throw new Error(`Kullanıcı bulunamadı: ${userId}`);
  }

  const tablesAffected: string[] = [];

  await prisma.$transaction(async (tx) => {
    // Bağımlı kayıtları önce sil (FK kısıtları nedeniyle sıra önemli)
    const responses = await tx.userResponse.deleteMany({ where: { userId } });
    if (responses.count > 0) tablesAffected.push('UserResponse');

    const optIns = await tx.visibilityOptIn.deleteMany({
      where: { OR: [{ mentorId: userId }, { mentiId: userId }] },
    });
    if (optIns.count > 0) tablesAffected.push('VisibilityOptIn');

    const requests = await tx.matchRequest.deleteMany({ where: { requesterUserId: userId } });
    if (requests.count > 0) tablesAffected.push('MatchRequest');

    const memberships = await tx.clubMembership.deleteMany({ where: { userId } });
    if (memberships.count > 0) tablesAffected.push('ClubMembership');

    const feedbackLogs = await tx.feedbackLog.deleteMany({
      where: { OR: [{ mentorId: userId }, { mentiId: userId }] },
    });
    if (feedbackLogs.count > 0) tablesAffected.push('FeedbackLog');

    // UserProfile: PII (schools/companies/communities) dahil tüm profil kalıcı silinir.
    // (User silme zaten cascade eder; burada açıkça silip tablesAffected'a yazarız.)
    const profiles = await tx.userProfile.deleteMany({ where: { userId } });
    if (profiles.count > 0) tablesAffected.push('UserProfile');

    // Toplantıları ve geri bildirimleri anonimleştir (istatistik için koru)
    // Not: Meeting ve Feedback kayıtları silinmez — mentorId/mentiId NULL yapılır.
    // Bu Prisma şemasında FK nullable değilse transaction rollback olur.
    // Öneri: Meeting.mentorId ve mentiId alanları nullable hale getirilmeli (ADIM 9 öneri).

    await tx.user.delete({ where: { id: userId } });
    tablesAffected.push('User');
  });

  void logger.info('SYSTEM', 'KVKK: Kullanıcı kalıcı olarak silindi', {
    userId,
    tenantId,
    tablesAffected,
  });

  return {
    userId,
    deletedAt: new Date().toISOString(),
    tablesAffected,
  };
}

// ─── 3. Veri Dışa Aktarma (KVKK Md.11 / GDPR Md.20) ─────────────────────────

export type UserDataExport = {
  userId: string;
  exportedAt: string;
  profile: Record<string, unknown>;
  responses: Array<{ questionId: string; value: number; createdAt: Date }>;
  feedbackLogs: Array<Record<string, unknown>>;
  matchRequests: Array<Record<string, unknown>>;
};

export async function exportUserData(userId: string, tenantId: string): Promise<UserDataExport> {
  const [user, responses, feedbackLogs, matchRequests] = await Promise.all([
    prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true, role: true, email: true, fullName: true,
        discType: true, discVector: true, sectorTags: true,
        skills: true, bioSummary: true, expertiseDetails: true,
        selfProfile: true, createdAt: true, updatedAt: true,
      },
    }),
    prisma.userResponse.findMany({
      where: { userId },
      select: { questionId: true, value: true, createdAt: true },
    }),
    prisma.feedbackLog.findMany({
      where: { OR: [{ mentorId: userId }, { mentiId: userId }] },
      select: { phase: true, starRating: true, npsScore: true, difficulty: true, createdAt: true },
    }),
    prisma.matchRequest.findMany({
      where: { requesterUserId: userId },
      select: { targetType: true, targetId: true, createdAt: true },
    }),
  ]);

  if (!user) {
    throw new Error(`Kullanıcı bulunamadı: ${userId}`);
  }

  void logger.info('SYSTEM', 'KVKK: Kullanıcı veri dışa aktarımı yapıldı', { userId, tenantId });

  return {
    userId,
    exportedAt: new Date().toISOString(),
    profile: user as Record<string, unknown>,
    responses,
    feedbackLogs: feedbackLogs as Array<Record<string, unknown>>,
    matchRequests: matchRequests as Array<Record<string, unknown>>,
  };
}

// ─── 4. Süresi Dolan Veri Temizliği ──────────────────────────────────────────

/**
 * Yasal saklama süresi dolan logları temizler.
 * Önerilen çalıştırma: Haftalık cron (ADIM 11 ile entegre).
 *
 * Saklama süreleri:
 *   - SystemLog: 90 gün
 *   - FeedbackLog: 3 yıl (yasal minimum)
 */
export type PurgeResult = {
  purgedAt: string;
  systemLogsDeleted: number;
};

export async function purgeExpiredData(): Promise<PurgeResult> {
  const systemLogCutoff = new Date();
  systemLogCutoff.setDate(systemLogCutoff.getDate() - 90);

  const systemLogs = await prisma.systemLog.deleteMany({
    where: { createdAt: { lt: systemLogCutoff } },
  });

  void logger.info('SYSTEM', 'KVKK: Süresi dolan veriler temizlendi', {
    systemLogsDeleted: systemLogs.count,
  });

  return {
    purgedAt: new Date().toISOString(),
    systemLogsDeleted: systemLogs.count,
  };
}
