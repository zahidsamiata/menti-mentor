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
import { deleteLocalAvatar } from './avatarStorage.js';
import { revokeConsent } from './consentService.js';

const JsonNull = Prisma.JsonNull;

const ANON_NAME = '[Silinmiş Kullanıcı]';
const ANON_EMAIL_PREFIX = 'deleted_';
// Bağlı serbest-metin yer tutucuları (NOT NULL kolonlar için — null yerine placeholder, migration gerekmez):
const ANON_MESSAGE_CONTENT = '[silindi]';       // Message.content (NOT NULL)
const ANON_AGREEMENT_GOAL = '[kaldırıldı]';     // MentorshipAgreement.mentiGoal (NOT NULL)

/**
 * Kullanıcıya dönen DÜRÜST kapanış mesajı (madde 39, PO kararı 2026-08-26).
 * "Silindi" DEMEZ — gerçek: kimliğe bağlanabilir veri anonimleştirilir, ortak kayıtlarda kimlik kaldırılır.
 * (c) yolu seçildi: userId (rastgele cuid, kişisel bilgi içermez) bağlı kayıtlarda kalır; tam
 * "geri-döndürülemez anonim" vaadi verilmez — bkz. KVKK 05-saklama-imha + kapak H-9.
 */
export const ACCOUNT_CLOSED_MESSAGE =
  'Hesabınız kapatıldı ve kimliğinizle ilişkilendirilebilir verileriniz geri döndürülemez şekilde ' +
  'anonimleştirildi. Diğer kullanıcılarla ortak kayıtlarda (görüşme, mesaj) kimliğiniz kaldırıldı.';

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
    select: { id: true, email: true, avatarUrl: true },
  });

  if (!user) {
    throw new Error(`Kullanıcı bulunamadı: ${userId}`);
  }

  // Fiziksel avatar dosyasını transaction SONRASI silmek için eski URL'i şimdi yakala
  // (transaction avatarUrl'i null'lar; dosya silme dış kaynak → transaction'a giremez).
  const previousAvatarUrl = user.avatarUrl;

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
        avatarUrl: null,          // PII: profil fotoğrafı bağlantısı (fiziksel dosya aşağıda silinir)
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

    // ── Oturum/token iptali (madde 39) — anonimleşen kullanıcı eski token'la işlem yapamamalı.
    // Middleware TenantMembership.isActive kontrol eder → tüm üyelikleri pasife al (hesap kapalı,
    // her tenant'ta erişim engellensin). Refresh/reset token'ları sil (yenileme de imkânsız).
    await tx.tenantMembership.updateMany({ where: { userId }, data: { isActive: false } });
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });

    // ── Bağlı tablolardaki SERBEST-METİN PII'yi temizle (madde 93 — tam anonimleştirme, (c) yolu).
    // Sahiplik-kapsamlı: yalnız anonimleşen kullanıcının YAZDIĞI/HAKKINDA-OLAN içerik. Karşı tarafın
    // (B) kendi yazdıkları KORUNUR. userId rastgele cuid olduğundan sorgu doğal olarak A'ya kapsanır.
    // Mesaj (iii): A'nın yazdığı içerik placeholder olur; B'nin mesajları + sohbet iskeleti kalır.
    await tx.message.updateMany({
      where: { senderUserId: userId },
      data: { content: ANON_MESSAGE_CONTENT },
    });
    // Görüşme serbest metni + telefon (doğrudan PII). Görüşme iki-taraflı, tek yazar alanı yok →
    // A'nın katıldığı görüşmelerin serbest metni temizlenir.
    await tx.meeting.updateMany({
      where: { OR: [{ mentorUserId: userId }, { mentiUserId: userId }] },
      data: { notes: null, requestMessage: null, phoneNumber: null, locationText: null },
    });
    // Görüşme check-in notları — yazarı userId (sahiplik net).
    await tx.meetingCheckIn.updateMany({
      where: { userId },
      data: { openNote: null, nextTopicNote: null },
    });
    // Geri bildirim serbest metinleri (skor/NPS gibi analitik alanlar KORUNUR).
    await tx.feedback.updateMany({
      where: { OR: [{ mentorId: userId }, { mentiId: userId }] },
      data: { keyLearnings: null, specificComments: null, periodicCareerGrowth: null },
    });
    // Eşleşme talebi + görünürlük opt-in serbest metinleri.
    await tx.matchRequest.updateMany({
      where: { requesterUserId: userId },
      data: { requestMessage: null },
    });
    await tx.visibilityOptIn.updateMany({
      where: { OR: [{ mentorId: userId }, { mentiId: userId }] },
      data: { iceBreaker: null, requestMessage: null },
    });
    // Şikayet açıklaması — yalnız A'nın YAZDIĞI (reporter). Hakkında yazılanlar (target) B'nin verisi → dokunma.
    await tx.userReport.updateMany({
      where: { reporterUserId: userId },
      data: { description: null },
    });
    // Mentörlük sözleşmesi menti hedefi (NOT NULL → placeholder).
    await tx.mentorshipAgreement.updateMany({
      where: { mentiId: userId },
      data: { mentiGoal: ANON_AGREEMENT_GOAL },
    });

    // ── KVKK açık rızasını geri çek (G1-05). Hesap kapanınca ACIK_RIZA geçerliliğini
    // yitirir; aktif satıra revokedAt=now() yazılır — YENİ SATIR AÇILMAZ, geçmiş SİLİNMEZ
    // (denetim izi korunur, bkz. consentService). AYDINLATMA bir onay değil bilgilendirme
    // beyanıdır → geri çekilmez. Aktif rıza yoksa (eski/backfill'siz kullanıcı) no-op.
    await revokeConsent({ userId }, 'ACIK_RIZA', tx);
  });

  // Transaction commit oldu → fiziksel avatar dosyasını best-effort sil (madde 93).
  // Log-devam: silme başarısız olsa bile anonimleştirme GERİ ALINMAZ (DB'de avatarUrl zaten null,
  // public URL kalmadı). deleteLocalAvatar ENOENT'i sessiz geçer, gerçek hatayı loglar (yetim dosya).
  await deleteLocalAvatar(previousAvatarUrl);

  const fieldsCleared = [
    'fullName', 'email', 'bioSummary', 'expertiseDetails', 'targetAudience',
    'volunteerHistory', 'pastProjects', 'education', 'selfProfile',
    'discVector', 'discType', 'temperamentJson', 'discResultCard', 'enneagramWing',
    'avatarUrl', 'avatarFile', 'linkedinUrl', 'instagramUrl',
    'userResponses', 'sessions',
    'userProfile.schools', 'userProfile.companies', 'userProfile.communities',
    'userProfile.disc', 'userProfile.ocean', 'userProfile.archetype',
    'message.content', 'meeting.notes', 'meeting.requestMessage', 'meeting.phoneNumber',
    'meeting.locationText', 'meetingCheckIn.openNote', 'meetingCheckIn.nextTopicNote',
    'feedback.keyLearnings', 'feedback.specificComments', 'feedback.periodicCareerGrowth',
    'matchRequest.requestMessage', 'visibilityOptIn.iceBreaker', 'visibilityOptIn.requestMessage',
    'userReport.description', 'mentorshipAgreement.mentiGoal',
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
  /** true → fiziksel silme değil, anonimleştirmeye yönlendirildi (madde 39, PO kararı). */
  anonymizedInstead: boolean;
};

/**
 * "Kalıcı silme" talebi (GDPR Md.17 / KVKK) — ANONİMLEŞTİRMEYE YÖNLENDİRİLİR.
 *
 * ⚠️ Madde 39 / PO kararı (2026-08-26): Gerçek fiziksel silme, User'a bağlı ~13 Restrict-FK tablosu
 * (Meeting/Feedback/Message/MentorshipAgreement…) nedeniyle transaction'ı rollback ediyordu → "silme"
 * fiilen ÇALIŞMIYOR ve çağrılınca patlıyordu. PO "silme yerine anonimleştirme" tercih etti (avukat
 * onaylı). Bu yüzden bu fonksiyon artık `anonymizeUser`'a delege eder: PII + serbest metin temizlenir,
 * oturum/token iptal edilir, avatar dosyası silinir. userId (rastgele cuid, kişisel bilgi içermez)
 * bağlı kayıtlarda kalır. Kullanıcıya "silindi" DENMEZ (bkz. ACCOUNT_CLOSED_MESSAGE + kapak H-9).
 */
export async function hardDeleteUser(userId: string, tenantId: string): Promise<HardDeleteResult> {
  const anon = await anonymizeUser(userId, tenantId);

  void logger.info('SYSTEM', 'KVKK: "Silme" talebi anonimleştirmeye yönlendirildi (madde 39)', {
    userId,
    tenantId,
  });

  return {
    userId,
    deletedAt: anon.anonymizedAt,
    tablesAffected: ['anonymized'],
    anonymizedInstead: true,
  };
}

/**
 * Self-servis hesap kapatma guard'ı (G1-05): Kullanıcı, kurumun SON aktif ADMIN'i mi?
 *
 * Son admin kendini kapatırsa kurum yönetici­siz (sahipsiz) kalır → self-servis kapatma
 * engellenir, açık hata verilir. Kurum-içi rol kaynağı TenantMembership.role'dür
 * (User.role DEĞİL — bkz. CLAUDE.md veri modeli; bir kullanıcı farklı kurumlarda farklı rolde
 * olabilir). MENTOR/MENTI için guard uygulanmaz (false döner).
 */
export async function isSoleActiveTenantAdmin(userId: string, tenantId: string): Promise<boolean> {
  const [selfIsActiveAdmin, otherActiveAdmins] = await Promise.all([
    prisma.tenantMembership.count({
      where: { tenantId, userId, role: 'ADMIN', isActive: true },
    }),
    prisma.tenantMembership.count({
      where: { tenantId, role: 'ADMIN', isActive: true, userId: { not: userId } },
    }),
  ]);
  return selfIsActiveAdmin > 0 && otherActiveAdmins === 0;
}

// ─── 3. Veri Dışa Aktarma (KVKK Md.11 / GDPR Md.20) ─────────────────────────

export type UserDataExport = {
  userId: string;
  exportedAt: string;
  profile: Record<string, unknown>;
  responses: Array<{ questionId: string; value: number; createdAt: Date }>;
  feedbackLogs: Array<Record<string, unknown>>;
  matchRequests: Array<Record<string, unknown>>;
  /** KVKK Md.11: verdiği/geri çektiği rızaların denetim izi (tip, sürüm, tarih). */
  consents: Array<Record<string, unknown>>;
  /** Yalnız SAYI — mesaj içeriği KARŞI TARAFI da içerir, dışa aktarılmaz (PII sızıntısı önlemi). */
  messageCount: number;
};

export async function exportUserData(userId: string, tenantId: string): Promise<UserDataExport> {
  const [user, responses, feedbackLogs, matchRequests, consents, messageCount] = await Promise.all([
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
    // Rıza denetim izi (kendi verisi) — Consent tenant-scope DIŞI, userId ile global.
    prisma.consent.findMany({
      where: { userId },
      select: { type: true, version: true, source: true, grantedAt: true, revokedAt: true },
      orderBy: { grantedAt: 'desc' },
    }),
    // Yalnız kendi gönderdiği mesajların SAYISI — içerik dışa aktarılmaz (karşı taraf PII'si).
    prisma.message.count({ where: { senderUserId: userId } }),
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
    consents: consents as Array<Record<string, unknown>>,
    messageCount,
  };
}

// ─── 4. Süresi Dolan Veri Temizliği ──────────────────────────────────────────

/**
 * KVKK yasal saklama süreleri — tek kaynak (sihirli sayı yok).
 * Süre değişirse yalnız burası düzeltilir.
 */
const SYSTEM_LOG_RETENTION_DAYS = 90;
const FEEDBACK_LOG_RETENTION_YEARS = 3; // yasal minimum

/**
 * Yasal saklama süresi dolan verileri temizler.
 * Önerilen çalıştırma: Haftalık cron (ADIM 11 ile entegre).
 *
 * Saklama süreleri:
 *   - SystemLog:   90 gün
 *   - FeedbackLog: 3 yıl (yasal minimum)
 *   - Message:     süre HENÜZ KARARLAŞMADI (bkz. TODO aşağıda / G1-10)
 */
export type PurgeResult = {
  purgedAt: string;
  systemLogsDeleted: number;
  feedbackLogsDeleted: number;
};

export async function purgeExpiredData(): Promise<PurgeResult> {
  const systemLogCutoff = new Date();
  systemLogCutoff.setDate(systemLogCutoff.getDate() - SYSTEM_LOG_RETENTION_DAYS);

  const feedbackLogCutoff = new Date();
  feedbackLogCutoff.setFullYear(feedbackLogCutoff.getFullYear() - FEEDBACK_LOG_RETENTION_YEARS);

  const systemLogs = await prisma.systemLog.deleteMany({
    where: { createdAt: { lt: systemLogCutoff } },
  });

  // FeedbackLog: 3 yıllık yasal saklama dolduğunda imha (createdAt bazlı; şema değişikliği yok).
  const feedbackLogs = await prisma.feedbackLog.deleteMany({
    where: { createdAt: { lt: feedbackLogCutoff } },
  });

  // TODO(G1-10): Message saklama süresi avukat aydınlatma metniyle belirlenecek.
  // Süre netleşene kadar Message imha kodu BİLİNÇLİ olarak YAZILMADI — kodda keyfi bir
  // süre uygularsak yayınlanacak aydınlatma metniyle çelişir (metin ↔ kod tutarlılığı).

  void logger.info('SYSTEM', 'KVKK: Süresi dolan veriler temizlendi', {
    systemLogsDeleted: systemLogs.count,
    feedbackLogsDeleted: feedbackLogs.count,
  });

  return {
    purgedAt: new Date().toISOString(),
    systemLogsDeleted: systemLogs.count,
    feedbackLogsDeleted: feedbackLogs.count,
  };
}
