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
import {
  MEMBERSHIP_EXPORT_SELECT,
  type MembershipExport,
  type MembershipExportScope,
} from './gdprMembershipExport.js';
import {
  EXPORT_PROFILE_SELECT,
  EXPORT_FEEDBACK_LOG_SELECT,
  EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT,
  EXPORT_MATCH_REQUEST_SELECT,
  EXPORT_USER_PROFILE_SELECT,
  EXPORT_MENTOR_FILTER_SELECT,
  EXPORT_AVAILABILITY_BLOCK_SELECT,
  EXPORT_CLUB_MEMBERSHIP_SELECT,
  EXPORT_PENDING_TAG_SELECT,
  EXPORT_VISIBILITY_OPT_IN_SELECT,
  EXPORT_MEETING_AS_MENTOR_SELECT,
  EXPORT_MEETING_AS_MENTI_SELECT,
  EXPORT_FEEDBACK_AS_MENTOR_SELECT,
  EXPORT_FEEDBACK_AS_MENTI_SELECT,
  EXPORT_MEETING_CHECK_IN_SELECT,
  EXPORT_MATCH_FEEDBACK_SELECT,
  EXPORT_USER_REPORT_SELECT,
  EXPORT_AGREEMENT_AS_MENTOR_SELECT,
  EXPORT_AGREEMENT_AS_MENTI_SELECT,
  EXPORT_CONVERSATION_AS_MENTOR_SELECT,
  EXPORT_CONVERSATION_AS_MENTI_SELECT,
  EXPORT_MESSAGE_SELECT,
} from './gdprOwnDataExport.js';

const JsonNull = Prisma.JsonNull;

const ANON_NAME = '[Silinmiş Kullanıcı]';
const ANON_EMAIL_PREFIX = 'deleted_';
// Bağlı serbest-metin yer tutucuları (NOT NULL kolonlar için — null yerine placeholder, migration gerekmez):
const ANON_MESSAGE_CONTENT = '[silindi]';       // Message.content (NOT NULL)
const ANON_AGREEMENT_GOAL = '[kaldırıldı]';     // MentorshipAgreement.mentiGoal (NOT NULL)
const ANON_ARCHETYPE = '[silindi]';             // Match.mentorArchetype/mentiArchetype (NOT NULL)

/**
 * Kullanıcıya dönen DÜRÜST kapanış mesajı (madde 39, PO kararı 2026-08-26).
 * "Silindi" DEMEZ — gerçek: kimliğe bağlanabilir veri anonimleştirilir, ortak kayıtlarda kimlik kaldırılır.
 * (c) yolu seçildi: userId (rastgele cuid, kişisel bilgi içermez) bağlı kayıtlarda kalır; tam
 * "geri-döndürülemez anonim" vaadi verilmez — bkz. KVKK 05-saklama-imha + kapak H-9.
 */
export const ACCOUNT_CLOSED_MESSAGE =
  'Hesabınız kapatıldı ve kimliğinizle ilişkilendirilebilir verileriniz geri döndürülemez şekilde ' +
  'anonimleştirildi. Diğer kullanıcılarla ortak kayıtlarda (görüşme, mesaj) kimliğiniz kaldırıldı.';

/**
 * Hedef kullanıcı İSTEK kurumunda yok (başka kurumda olabilir ya da hiç yok).
 * Kontrolcü bunu jenerik 404'e çevirir — varlık ifşa edilmez (K5-Y3b: önceden 500 dönüyordu).
 */
export class GdprUserNotFoundError extends Error {
  constructor() {
    super('GDPR hedef kullanıcısı istek kurumunda bulunamadı');
    this.name = 'GdprUserNotFoundError';
  }
}

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
    throw new GdprUserNotFoundError();
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
        // GV-08 (güvenlik konseyi §2.B.2): daha önce atlanan 4 alandan 2'si — password ve
        // rejectionReason KARAR-39'dan BAĞIMSIZ, tartışmasız birer PII/kimlik-bilgisi bug'ıydı.
        password: null,           // OAuth olmayan hesapta bile artık gerek yok — anonim hesap giriş yapamaz
        rejectionReason: null,    // admin'in kişi hakkında yazdığı serbest metin (PII)
      },
    });

    // Kullanıcı yanıtlarını sil (DISC soruları — kişilik profili)
    await tx.userResponse.deleteMany({ where: { userId } });

    // UserProfile: PII/kişilik alanlarını temizle, Analitik (skill/goal/industry/yearsExp) koru.
    // updateMany kullanılır — profil satırı yoksa sessizce no-op olur.
    // Profilin KENDİ id'si (userId FK'i değil) — aşağıda Match.mentorId/mentiId eşlemesi için gerekli.
    const profile = await tx.userProfile.findFirst({ where: { userId }, select: { id: true } });
    await tx.userProfile.updateMany({
      where: { userId },
      data: {
        schools: [], companies: [], communities: [],           // PII bağlam
        discD: 0, discI: 0, discS: 0, discC: 0,                 // kişilik verisi
        oceanO: null, oceanC: null, oceanE: null, oceanA: null, oceanN: null,
        archetype: null,
      },
    });
    // GV-08 / KARAR-39 (arketip ayağı karardan BAĞIMSIZ — bkz. 00-KUYRUK.md GV-08 satırı):
    // UserProfile.archetype temizleniyor ama AYNI arketip Match tablosunda düz metin duruyordu
    // (NOT NULL → placeholder). MatchFeedback.comment (KARAR-39'un "yorum ayağı") kasıtlı
    // DOKUNULMADI — o genuinely PO kararını bekliyor (yazarın verisi mi, silinir mi tartışmalı).
    if (profile) {
      await tx.match.updateMany({ where: { mentorId: profile.id }, data: { mentorArchetype: ANON_ARCHETYPE } });
      await tx.match.updateMany({ where: { mentiId: profile.id }, data: { mentiArchetype: ANON_ARCHETYPE } });
    }

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
    // AN-27: zaman önerisinde A'nın talep ettiği zaman da A'nın girdisidir → temizlenir (kind = tip
    // işareti, kişisel veri değil; kalır ki sohbet iskeleti "burada bir öneri vardı" desin).
    await tx.message.updateMany({
      where: { senderUserId: userId },
      data: { content: ANON_MESSAGE_CONTENT, proposedStartAt: null },
    });
    // Görüşme serbest metni + telefon (doğrudan PII). Görüşme iki-taraflı, tek yazar alanı yok →
    // A'nın katıldığı görüşmelerin serbest metni temizlenir.
    await tx.meeting.updateMany({
      where: { OR: [{ mentorUserId: userId }, { mentiUserId: userId }] },
      data: { notes: null, requestMessage: null, phoneNumber: null, locationText: null, locationUrl: null },
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
    // GV-08 (+4 alan): denetleyenin (admin) kendi yazdığı inceleme notu — sahiplik reviewedBy'da,
    // reporter/target'tan bağımsız. KARAR-39'dan bağımsız (yorum tartışması Match/MatchFeedback'e özgü).
    await tx.userReport.updateMany({
      where: { reviewedBy: userId },
      data: { reviewNote: null },
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
    'avatarUrl', 'avatarFile', 'linkedinUrl', 'instagramUrl', 'password', 'rejectionReason',
    'userResponses', 'sessions',
    'userProfile.schools', 'userProfile.companies', 'userProfile.communities',
    'userProfile.disc', 'userProfile.ocean', 'userProfile.archetype',
    'message.content', 'message.proposedStartAt', 'meeting.notes', 'meeting.requestMessage', 'meeting.phoneNumber',
    'meeting.locationText', 'meeting.locationUrl', 'meetingCheckIn.openNote', 'meetingCheckIn.nextTopicNote',
    'feedback.keyLearnings', 'feedback.specificComments', 'feedback.periodicCareerGrowth',
    'matchRequest.requestMessage', 'visibilityOptIn.iceBreaker', 'visibilityOptIn.requestMessage',
    'userReport.description', 'userReport.reviewNote', 'mentorshipAgreement.mentiGoal',
    'match.mentorArchetype', 'match.mentiArchetype',
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

/** Kişinin tarafı — iki taraflı kayıtlarda (görüşme, değerlendirme, anlaşma, konuşma) hangi rolde olduğu. */
export type ExportSide = 'MENTOR' | 'MENTI';
type ExportRow = Record<string, unknown>;

export type UserDataExport = {
  userId: string;
  exportedAt: string;
  /** AJ-126: kişinin kendi profil alanları (izin/hariç listesi: gdprOwnDataExport.ts). */
  profile: Record<string, unknown>;
  responses: Array<{ questionId: string; value: number; createdAt: Date }>;
  /** Kişinin MENTÖR olduğu (kendi yazdığı) satırlarda AJ-126 ile `goalAchieved` de var. */
  feedbackLogs: ExportRow[];
  /** Kişinin GÖNDERDİĞİ istekler; AJ-126 ile `requestMessage` de var. */
  matchRequests: ExportRow[];
  /** KVKK Md.11: verdiği/geri çektiği rızaların denetim izi (tip, sürüm, tarih). */
  consents: ExportRow[];
  /** Kişinin gönderdiği mesaj SAYISI (geriye uyum — içerikler `messagesSent`'te). */
  messageCount: number;
  /**
   * AJ-124: kurum üyelikleri (rol, sertifika, öğrenme yolculuğu, katılım tarihi). Kapsam
   * `membershipScope`'a göre: kendi isteğinde TÜM kurumlar, yönetici isteğinde yalnız o kurum.
   * Alan listesi + hariç tutma gerekçeleri: gdprMembershipExport.ts.
   */
  memberships: MembershipExport[];
  // ── AJ-126 (a): kişinin KENDİ ürettiği/kendisine ait kayıtlar (alanlar: gdprOwnDataExport.ts) ──
  userProfile: ExportRow | null;
  mentorFilter: ExportRow | null;
  availabilityBlocks: ExportRow[];
  clubMemberships: ExportRow[];
  /** Kişinin önerdiği etiketler (PendingTag). */
  suggestedTags: ExportRow[];
  /** Kişinin BAŞLATTIĞI görünürlük istekleri. */
  visibilityRequests: ExportRow[];
  meetings: ExportRow[];
  meetingCheckIns: ExportRow[];
  /** Kişinin görüşme sonrası KENDİ yazdığı değerlendirme alanları (karşı tarafınki yok). */
  meetingFeedbacks: ExportRow[];
  matchFeedbacks: ExportRow[];
  reportsMade: ExportRow[];
  agreements: ExportRow[];
  conversations: ExportRow[];
  /** Kişinin GÖNDERDİĞİ mesajların içeriği. Aldığı mesajlar KARAR-138 bekliyor. */
  messagesSent: ExportRow[];
};

/** Kurum-filtreli (src/db.ts TENANT_SCOPED) kendi kayıtlarının kişi-ilişkisi seçimleri. */
const OWN_SCOPED_RELATIONS_SELECT = {
  memberships: { select: MEMBERSHIP_EXPORT_SELECT, orderBy: { createdAt: 'asc' } },
  feedbackLogs_as_mentor: { select: EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT },
  feedbackLogs_as_menti: { select: EXPORT_FEEDBACK_LOG_SELECT },
  requestsSent: { select: EXPORT_MATCH_REQUEST_SELECT },
  availabilityBlocks: { select: EXPORT_AVAILABILITY_BLOCK_SELECT },
  clubMemberships: { select: EXPORT_CLUB_MEMBERSHIP_SELECT },
  pendingTags: { select: EXPORT_PENDING_TAG_SELECT },
  mentorOptIns: { where: { initiatedBy: 'MENTOR' }, select: EXPORT_VISIBILITY_OPT_IN_SELECT },
  mentiOptIns: { where: { initiatedBy: 'MENTI' }, select: EXPORT_VISIBILITY_OPT_IN_SELECT },
  meetingsAsMentor: { select: EXPORT_MEETING_AS_MENTOR_SELECT },
  meetingsAsMenti: { select: EXPORT_MEETING_AS_MENTI_SELECT },
  // Şema adı yanıltıcı: "FeedbacksGiven" = mentorId, "FeedbacksReceived" = mentiId. Her iki tarafta
  // da yalnız o tarafın YAZDIĞI alanlar seçilir (feedbackController KARAR 1).
  feedbacksGiven: { select: EXPORT_FEEDBACK_AS_MENTOR_SELECT },
  feedbacksReceived: { select: EXPORT_FEEDBACK_AS_MENTI_SELECT },
} as const satisfies Prisma.UserSelect;

type OwnScopedRelations = Prisma.UserGetPayload<{ select: typeof OWN_SCOPED_RELATIONS_SELECT }>;
type ExportProfile = Prisma.UserGetPayload<{ select: typeof EXPORT_PROFILE_SELECT }>;
type ExportSubject = ExportProfile & OwnScopedRelations;

/**
 * Dışa aktarılan kişinin profili + kurum-filtreli modellerdeki kendi kayıtları.
 *
 * 'all' (YALNIZ kişinin KENDİ isteği — controller userId'yi oturumdan/kendi-kontrolünden verir):
 *   Kurum filtresi (src/db.ts RLS eklentisi) BİLİNÇLİ olarak aşılır — `findUnique` eklentinin
 *   READ_OPS'u dışındadır ve iç içe seçimler ayrı bir üst düzey sorgu olmadığı için filtrelenmez.
 *   NEDEN: KVKK Md.11 erişim hakkı kişinin TÜM kurumlardaki kaydını kapsar (misafir üyelik —
 *   AJ-124/AJ-125/AJ-126). Sorgu yalnız `where: { id: userId }` ile tek kişiye bağlı; ilişkiler
 *   yalnız o kişinin taraf olduğu satırları getirir, başka kişinin satırı dönemez. Seçilen alanlar
 *   yönetici yoluyla AYNI.
 * 'requestTenant' (yönetici başkasını dışa aktarıyor): kişi istek kurumunun kaydı olmalı
 *   (`findFirst { id, tenantId }`), kayıtlar yalnız o kurumdaki (üst düzey findMany + açık tenantId;
 *   eklenti de aynı filtreyi ekler).
 */
async function findExportSubject(
  userId: string,
  tenantId: string,
  scope: MembershipExportScope,
): Promise<ExportSubject | null> {
  if (scope === 'all') {
    // eslint-disable-next-line no-restricted-syntax -- AJ-124/125/126: kişinin KENDİ KVKK dışa aktarımı; tüm kurumlardaki kendi kayıtları bilinçli olarak okunur, sorgu yalnız kendi id'sine bağlı (bkz. üstteki yorum).
    return prisma.user.findUnique({
      where: { id: userId },
      select: { ...EXPORT_PROFILE_SELECT, ...OWN_SCOPED_RELATIONS_SELECT },
    });
  }
  const inTenant = { tenantId };
  const [
    user, memberships, feedbackLogsAsMentor, feedbackLogsAsMenti, requestsSent, availabilityBlocks,
    clubMemberships, pendingTags, mentorOptIns, mentiOptIns, meetingsAsMentor, meetingsAsMenti,
    feedbacksGiven, feedbacksReceived,
  ] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, tenantId }, select: EXPORT_PROFILE_SELECT }),
    prisma.tenantMembership.findMany({
      where: { userId, ...inTenant },
      select: MEMBERSHIP_EXPORT_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.feedbackLog.findMany({ where: { mentorId: userId, ...inTenant }, select: EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT }),
    prisma.feedbackLog.findMany({ where: { mentiId: userId, ...inTenant }, select: EXPORT_FEEDBACK_LOG_SELECT }),
    prisma.matchRequest.findMany({ where: { requesterUserId: userId, ...inTenant }, select: EXPORT_MATCH_REQUEST_SELECT }),
    prisma.availabilityBlock.findMany({ where: { userId, ...inTenant }, select: EXPORT_AVAILABILITY_BLOCK_SELECT }),
    prisma.clubMembership.findMany({ where: { userId, ...inTenant }, select: EXPORT_CLUB_MEMBERSHIP_SELECT }),
    prisma.pendingTag.findMany({ where: { submittedBy: userId, ...inTenant }, select: EXPORT_PENDING_TAG_SELECT }),
    prisma.visibilityOptIn.findMany({
      where: { mentorId: userId, initiatedBy: 'MENTOR', ...inTenant },
      select: EXPORT_VISIBILITY_OPT_IN_SELECT,
    }),
    prisma.visibilityOptIn.findMany({
      where: { mentiId: userId, initiatedBy: 'MENTI', ...inTenant },
      select: EXPORT_VISIBILITY_OPT_IN_SELECT,
    }),
    prisma.meeting.findMany({ where: { mentorUserId: userId, ...inTenant }, select: EXPORT_MEETING_AS_MENTOR_SELECT }),
    prisma.meeting.findMany({ where: { mentiUserId: userId, ...inTenant }, select: EXPORT_MEETING_AS_MENTI_SELECT }),
    prisma.feedback.findMany({ where: { mentorId: userId, ...inTenant }, select: EXPORT_FEEDBACK_AS_MENTOR_SELECT }),
    prisma.feedback.findMany({ where: { mentiId: userId, ...inTenant }, select: EXPORT_FEEDBACK_AS_MENTI_SELECT }),
  ]);
  if (!user) return null;
  return {
    ...user,
    memberships,
    feedbackLogs_as_mentor: feedbackLogsAsMentor,
    feedbackLogs_as_menti: feedbackLogsAsMenti,
    requestsSent,
    availabilityBlocks,
    clubMemberships,
    pendingTags,
    mentorOptIns,
    mentiOptIns,
    meetingsAsMentor,
    meetingsAsMenti,
    feedbacksGiven,
    feedbacksReceived,
  };
}

/**
 * Kurum filtresi DIŞINDAKİ modellerde (UserProfile, MentorFilter, MeetingCheckIn, MatchFeedback,
 * UserReport, MentorshipAgreement, Conversation, Message — src/db.ts TENANT_SCOPED'da yok) kişinin
 * kendi kayıtları. Eklenti bunlara filtre eklemez → 'requestTenant' kapsamında kurum filtresi
 * burada AÇIKÇA konur (yönetici, kişinin başka kurumdaki kaydını göremez). UserProfile/MentorFilter
 * kişi-genel tek satırdır (kurum kolonu yok); yönetici yolunda kişi zaten o kurumun kaydıdır.
 */
async function findOwnUnscopedRecords(userId: string, tenantId: string, scope: MembershipExportScope) {
  const inTenant = scope === 'all' ? {} : { tenantId };
  const [
    userProfile, mentorFilter, meetingCheckIns, matchFeedbacks, reportsMade,
    agreementsAsMentor, agreementsAsMenti, conversationsAsMentor, conversationsAsMenti, messagesSent,
  ] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId }, select: EXPORT_USER_PROFILE_SELECT }),
    prisma.mentorFilter.findUnique({ where: { mentorId: userId }, select: EXPORT_MENTOR_FILTER_SELECT }),
    prisma.meetingCheckIn.findMany({ where: { userId, ...inTenant }, select: EXPORT_MEETING_CHECK_IN_SELECT }),
    prisma.matchFeedback.findMany({
      where: { fromUserId: userId, ...(scope === 'all' ? {} : { match: { tenantId } }) },
      select: EXPORT_MATCH_FEEDBACK_SELECT,
    }),
    prisma.userReport.findMany({ where: { reporterUserId: userId, ...inTenant }, select: EXPORT_USER_REPORT_SELECT }),
    prisma.mentorshipAgreement.findMany({ where: { mentorId: userId, ...inTenant }, select: EXPORT_AGREEMENT_AS_MENTOR_SELECT }),
    prisma.mentorshipAgreement.findMany({ where: { mentiId: userId, ...inTenant }, select: EXPORT_AGREEMENT_AS_MENTI_SELECT }),
    prisma.conversation.findMany({ where: { mentorUserId: userId, ...inTenant }, select: EXPORT_CONVERSATION_AS_MENTOR_SELECT }),
    prisma.conversation.findMany({ where: { mentiUserId: userId, ...inTenant }, select: EXPORT_CONVERSATION_AS_MENTI_SELECT }),
    prisma.message.findMany({
      where: { senderUserId: userId, ...(scope === 'all' ? {} : { conversation: { tenantId } }) },
      select: EXPORT_MESSAGE_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    userProfile, mentorFilter, meetingCheckIns, matchFeedbacks, reportsMade,
    agreementsAsMentor, agreementsAsMenti, conversationsAsMentor, conversationsAsMenti, messagesSent,
  };
}

/** İki taraflı kayıtlara kişinin tarafını ekler (karşı tarafın kimliği yerine). */
function withSide<T extends object>(side: ExportSide, rows: T[]): Array<T & { side: ExportSide }> {
  return rows.map((row) => ({ ...row, side }));
}

/** Konuşmada yalnız KENDİ okuma anı `lastReadAt` olarak verilir (karşı tarafınki seçilmez). */
function normalizeConversations(
  asMentor: Array<{ mentorLastReadAt: Date | null } & ExportRow>,
  asMenti: Array<{ mentiLastReadAt: Date | null } & ExportRow>,
): ExportRow[] {
  return [
    ...asMentor.map(({ mentorLastReadAt, ...c }) => ({ ...c, lastReadAt: mentorLastReadAt, side: 'MENTOR' as const })),
    ...asMenti.map(({ mentiLastReadAt, ...c }) => ({ ...c, lastReadAt: mentiLastReadAt, side: 'MENTI' as const })),
  ];
}

/**
 * @param membershipScope 'all' yalnız kişinin KENDİ isteğinde verilir (self-servis). Varsayılan
 *   'requestTenant' — güvenli taraf: başka biri dışa aktarırken kişinin diğer kurum kayıtları sızmaz.
 */
export async function exportUserData(
  userId: string,
  tenantId: string,
  membershipScope: MembershipExportScope = 'requestTenant',
): Promise<UserDataExport> {
  const [subject, unscoped, responses, consents, messageCount] = await Promise.all([
    findExportSubject(userId, tenantId, membershipScope),
    findOwnUnscopedRecords(userId, tenantId, membershipScope),
    prisma.userResponse.findMany({
      where: { userId },
      select: { questionId: true, value: true, createdAt: true },
    }),
    // Rıza denetim izi (kendi verisi) — Consent tenant-scope DIŞI, userId ile global.
    prisma.consent.findMany({
      where: { userId },
      select: { type: true, version: true, source: true, grantedAt: true, revokedAt: true },
      orderBy: { grantedAt: 'desc' },
    }),
    // Geriye uyum: gönderilen mesaj sayısı (frontend özet kartı okur).
    prisma.message.count({ where: { senderUserId: userId } }),
  ]);

  if (!subject) {
    throw new GdprUserNotFoundError();
  }
  const {
    memberships, feedbackLogs_as_mentor, feedbackLogs_as_menti, requestsSent, availabilityBlocks,
    clubMemberships, pendingTags, mentorOptIns, mentiOptIns, meetingsAsMentor, meetingsAsMenti,
    feedbacksGiven, feedbacksReceived, ...user
  } = subject;

  void logger.info('SYSTEM', 'KVKK: Kullanıcı veri dışa aktarımı yapıldı', { userId, tenantId });

  return {
    userId,
    exportedAt: new Date().toISOString(),
    profile: user as Record<string, unknown>,
    responses,
    feedbackLogs: [...feedbackLogs_as_mentor, ...feedbackLogs_as_menti],
    matchRequests: requestsSent,
    consents,
    messageCount,
    memberships,
    userProfile: unscoped.userProfile,
    mentorFilter: unscoped.mentorFilter,
    availabilityBlocks,
    clubMemberships,
    suggestedTags: pendingTags,
    visibilityRequests: [...mentorOptIns, ...mentiOptIns],
    meetings: [...withSide('MENTOR', meetingsAsMentor), ...withSide('MENTI', meetingsAsMenti)],
    meetingCheckIns: unscoped.meetingCheckIns,
    meetingFeedbacks: [...withSide('MENTOR', feedbacksGiven), ...withSide('MENTI', feedbacksReceived)],
    matchFeedbacks: unscoped.matchFeedbacks,
    reportsMade: unscoped.reportsMade,
    agreements: [
      ...withSide('MENTOR', unscoped.agreementsAsMentor),
      ...withSide('MENTI', unscoped.agreementsAsMenti),
    ],
    conversations: normalizeConversations(unscoped.conversationsAsMentor, unscoped.conversationsAsMenti),
    messagesSent: unscoped.messagesSent,
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
  /** AJ-17: kurum-kapsamlı (elle) çağrıda true — SystemLog platform geneli olduğu için atlandı. */
  systemLogsSkipped?: boolean;
};

/**
 * AJ-17: `opts.tenantId` verilirse yalnız o kurumun verisi işlenir (elle tetikleme —
 * kurum yöneticisi başka kurumun kaydını silemesin/etkilemesin). Argümansız çağrı (otomatik
 * haftalık cron) davranışı DEĞİŞMEDİ — platform genelinde çalışmaya devam eder.
 *
 * SystemLog'da `tenantId` kolonu YOK (platform-geneli log; kurum bilgisi yalnız `meta` JSON
 * içinde, güvenilir filtre değil) — bu yüzden kurum-kapsamlı çağrıda SystemLog temizliği
 * ATLANIR (platform logu kurum yöneticisinin yetki alanı değil). Şema DEĞİŞMEDİ.
 */
export async function purgeExpiredData(opts?: { tenantId?: string }): Promise<PurgeResult> {
  const tenantId = opts?.tenantId;

  const systemLogCutoff = new Date();
  systemLogCutoff.setDate(systemLogCutoff.getDate() - SYSTEM_LOG_RETENTION_DAYS);

  const feedbackLogCutoff = new Date();
  feedbackLogCutoff.setFullYear(feedbackLogCutoff.getFullYear() - FEEDBACK_LOG_RETENTION_YEARS);

  let systemLogsDeleted = 0;
  if (!tenantId) {
    const systemLogs = await prisma.systemLog.deleteMany({
      where: { createdAt: { lt: systemLogCutoff } },
    });
    systemLogsDeleted = systemLogs.count;
  }

  // FeedbackLog: 3 yıllık yasal saklama dolduğunda imha (createdAt bazlı; şema değişikliği yok).
  // tenantId verilirse yalnız o kurumun kayıtları hedeflenir.
  const feedbackLogs = await prisma.feedbackLog.deleteMany({
    where: {
      createdAt: { lt: feedbackLogCutoff },
      ...(tenantId ? { tenantId } : {}),
    },
  });

  // TODO(G1-10): Message saklama süresi avukat aydınlatma metniyle belirlenecek.
  // Süre netleşene kadar Message imha kodu BİLİNÇLİ olarak YAZILMADI — kodda keyfi bir
  // süre uygularsak yayınlanacak aydınlatma metniyle çelişir (metin ↔ kod tutarlılığı).

  void logger.info('SYSTEM', 'KVKK: Süresi dolan veriler temizlendi', {
    systemLogsDeleted,
    feedbackLogsDeleted: feedbackLogs.count,
    ...(tenantId ? { tenantId, systemLogsSkipped: true } : {}),
  });

  return {
    purgedAt: new Date().toISOString(),
    systemLogsDeleted,
    feedbackLogsDeleted: feedbackLogs.count,
    ...(tenantId ? { systemLogsSkipped: true } : {}),
  };
}
