/**
 * AJ-126 (a) — KVKK "verilerimi indir" çıktısına kişinin KENDİ ürettiği / kendisine ait veri.
 *
 * NEDEN: KVKK Md.11 erişim hakkı — kişi hakkında tutulan ve kişinin kendi girdiği veri eksiksiz
 * verilmeli. Önceki dışa aktarma profilden yalnız 13 alan, mesajdan yalnız sayı veriyordu; mizaç
 * sonucu, geçmiş (gönüllülük/proje/eğitim), sosyal hesaplar, müsaitlik, kulüp, önerilen etiket,
 * görüşme talebi/check-in/değerlendirme, şikâyet, anlaşma, konuşma ve gönderilen mesaj içerikleri
 * hiç yoktu. Kaynak: 7b #298 (a)/(b) ayrımı, 00-KUYRUK AJ-126.
 *
 * SINIR — (b) ayağı KARAR-138 bekliyor: BAŞKASININ kişi HAKKINDA yazdıkları (yöneticinin onay/red
 * notu, karşı tarafın değerlendirme puanları, alınan mesajlar, şikâyetin inceleme sonucu, görüşme
 * notu) BURAYA EKLENMEZ. Yazar ayrımı kod gerçeğinden alındı:
 *   - Feedback: feedbackController KARAR 1 bölümlemesi (mentör → preparedness/proactivity/
 *     engagement/goalClarity/keyLearnings/specificComments/periodic*; menti → guidance/
 *     resourceSharing/trust). Kişi yalnız KENDİ tarafının yazdığı alanları alır.
 *   - Meeting: menti rezervasyon yapar (requestMessage/locationText/phoneNumber menti girer),
 *     mentör onaylarken locationUrl girer (meetingController bookMeeting/approve). `notes` iptal
 *     gerekçesi / mentör notu → (b), eklenmez.
 *   - FeedbackLog: yalnız MENTOR/ADMIN yazar → goalAchieved yalnız kişinin MENTÖR olduğu satırlarda.
 *   - VisibilityOptIn: yazan taraf `initiatedBy` → yalnız kişinin başlattığı satırlar.
 * Karşı tarafın kimliği (id) ya da kişisel verisi (ad, e-posta, okuma izi, onay anı) HİÇBİR
 * satırda seçilmez.
 *
 * Bu dosya DB'ye dokunmaz (saf sabitler) — şema-kapsam birim testi
 * (tests/aj126-kendi-verisi-disa-aktarma-sema.unit.test.ts) schema.prisma'daki her ilgili modelin
 * skaler alanlarını buradaki İZİN + HARİÇ listeleriyle karşılaştırır. ⭐ Şemaya yeni alan eklenince
 * test KIRMIZI olur: alan ya izin listesine ya gerekçeli hariç listesine yazılmalı.
 * Sır/token/hash ASLA dahil edilmez.
 */

import type { Prisma } from '@prisma/client';

const KARAR_138 = 'KARAR-138 bekliyor — başkasının kişi hakkında yazdığı veri ((b) ayağı); cevap "evet" ise izin listesine taşınır.';
const COUNTERPART_ID = 'Karşı tarafın kimliği — dışa aktarmaya karşı tarafın kişisel verisi eklenmez.';
const SELF_ID = 'Kişinin kendi kimliği; dışa aktarmanın en üstünde `userId` olarak zaten var (tekrar).';
const ROW_KEY = 'Teknik satır anahtarı; kişi hakkında bilgi taşımaz.';

// ─── User (profil) ────────────────────────────────────────────────────────────

/** Dışa aktarılan profil alanları (explicit select — password YOK). */
export const EXPORT_PROFILE_SELECT = {
  id: true, tenantId: true, role: true, email: true, authProvider: true, fullName: true, isActive: true,
  sectorTags: true, skills: true,
  discType: true, discVector: true, discResultCard: true, temperamentJson: true, enneagramWing: true,
  discAssessmentCompletedAt: true,
  volunteerHistory: true, pastProjects: true, education: true, selfProfile: true,
  bioSummary: true, expertiseDetails: true, targetAudience: true,
  timeCommitment: true, expectationCategories: true, interactionStyle: true,
  mentiNeeds: true, mentorStrengths: true, supportApproach: true, priorityValue: true,
  rematchPriority: true, rematchCount: true, needsOrientation: true,
  approvalStatus: true, approvedAt: true, rejectedAt: true,
  kvkkConsentAt: true, mentorVisibilityEnabled: true,
  avatarUrl: true, linkedinUrl: true, instagramUrl: true,
  createdAt: true, updatedAt: true,
} as const satisfies Prisma.UserSelect;

export const PROFILE_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  password: 'Sır (parola özeti) — dışa aktarmaya ASLA girmez.',
  lastLoginAt: 'Oturum/güvenlik izi (son giriş anı) — oturum sayaçları dışa aktarılmaz (AJ-126 kapsam kuralı).',
  approvedBy: `Onaylayan yöneticinin kimliği. ${KARAR_138}`,
  rejectedBy: `Reddeden yöneticinin kimliği. ${KARAR_138}`,
  rejectionReason: `Yöneticinin kişi hakkında yazdığı red gerekçesi. ${KARAR_138}`,
};

// ─── Görüşme geri bildirimi (FeedbackLog) / eşleşme isteği (MatchRequest) ────────

/** Kişinin MENTİ olduğu satırlar (mentörün yazdığı kayıt) — AJ-125 alan kümesi, DEĞİŞMEDİ. */
export const EXPORT_FEEDBACK_LOG_SELECT = {
  phase: true, starRating: true, npsScore: true, difficulty: true, createdAt: true,
} as const satisfies Prisma.FeedbackLogSelect;

/** Kişinin MENTÖR olduğu satırlar — kaydı kendisi yazdı → goalAchieved de kendi verisi. */
export const EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT = {
  ...EXPORT_FEEDBACK_LOG_SELECT, goalAchieved: true,
} as const satisfies Prisma.FeedbackLogSelect;

export const FEEDBACK_LOG_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  tenantId: 'Kurum bağlamı — yönetici yolu ile alan kümesi eşit tutulur (AJ-125).',
  mentorId: COUNTERPART_ID,
  mentiId: COUNTERPART_ID,
};

/** Kişinin GÖNDERDİĞİ eşleşme istekleri — isteğin mesajı kendi yazdığı metin. */
export const EXPORT_MATCH_REQUEST_SELECT = {
  targetType: true, targetId: true, requestMessage: true, createdAt: true,
} as const satisfies Prisma.MatchRequestSelect;

export const MATCH_REQUEST_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  tenantId: 'Kurum bağlamı — AJ-125 alan kümesi korunur.',
  requesterUserId: SELF_ID,
};

// ─── Tek satırlık kişi kayıtları ────────────────────────────────────────────────

export const EXPORT_USER_PROFILE_SELECT = {
  discD: true, discI: true, discS: true, discC: true,
  oceanO: true, oceanC: true, oceanE: true, oceanA: true, oceanN: true,
  archetype: true, archetypeRole: true, profileSource: true,
  industryCode: true, yearsExp: true, skillTags: true, goalTags: true,
  schools: true, companies: true, communities: true,
  isCertified: true, certificationStatus: true, certScore: true, certifiedAt: true,
  certAttempts: true, cooldownUntil: true,
} as const satisfies Prisma.UserProfileSelect;

export const USER_PROFILE_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  userId: SELF_ID,
  qualityMultiplier:
    'Kişi hakkında türetilmiş kalite puanı — erişim hakkı kapsamı PO kararı bekliyor (03-PO-ELLE-ISLER A11 / KARAR-91). AJ-124 üyelik hariç listesiyle aynı gerekçe.',
};

export const EXPORT_MENTOR_FILTER_SELECT = {
  minCompatibilityScore: true, blockedDiscTypes: true, filterEnabled: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.MentorFilterSelect;

export const MENTOR_FILTER_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  mentorId: SELF_ID,
};

// ─── Kurum-içi kendi kayıtları (tenant-scoped modeller) ─────────────────────────

export const EXPORT_AVAILABILITY_BLOCK_SELECT = {
  tenantId: true, weekday: true, startTime: true, endTime: true, timezone: true, isActive: true,
  createdAt: true, updatedAt: true,
} as const satisfies Prisma.AvailabilityBlockSelect;

export const AVAILABILITY_BLOCK_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  userId: SELF_ID,
};

/** `club` ilişkisi yalnız bağlam: kulübün adı — kulübün başka üyelerine ait HİÇBİR veri seçilmez. */
export const EXPORT_CLUB_MEMBERSHIP_SELECT = {
  tenantId: true, clubId: true, club: { select: { name: true } }, role: true, joinedAt: true,
} as const satisfies Prisma.ClubMembershipSelect;

export const CLUB_MEMBERSHIP_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  userId: SELF_ID,
};

/** Kişinin önerdiği etiketler (PendingTag.submittedBy = kişi). */
export const EXPORT_PENDING_TAG_SELECT = {
  tenantId: true, value: true, status: true, mergedInto: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.PendingTagSelect;

export const PENDING_TAG_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  submittedBy: SELF_ID,
};

/** Görünürlük isteği — yalnız kişinin BAŞLATTIĞI satırlar (initiatedBy = kişinin tarafı). */
export const EXPORT_VISIBILITY_OPT_IN_SELECT = {
  tenantId: true, status: true, initiatedBy: true, iceBreaker: true, requestMessage: true,
  createdAt: true, updatedAt: true,
} as const satisfies Prisma.VisibilityOptInSelect;

export const VISIBILITY_OPT_IN_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  mentorId: `${COUNTERPART_ID} (kişinin kendi id'si ise tekrar).`,
  mentiId: `${COUNTERPART_ID} (kişinin kendi id'si ise tekrar).`,
};

const MEETING_BASE_SELECT = {
  id: true, tenantId: true, startsAt: true, endsAt: true, status: true, format: true,
  durationMin: true, hasFeedback: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.MeetingSelect;

/** Kişinin MENTİ olduğu görüşme: talebi kendisi oluşturdu → mesaj + konum metni + telefon kendisinin. */
export const EXPORT_MEETING_AS_MENTI_SELECT = {
  ...MEETING_BASE_SELECT, requestMessage: true, locationText: true, phoneNumber: true,
} as const satisfies Prisma.MeetingSelect;

/** Kişinin MENTÖR olduğu görüşme: onaylarken girdiği bağlantı kendisinin. */
export const EXPORT_MEETING_AS_MENTOR_SELECT = {
  ...MEETING_BASE_SELECT, locationUrl: true,
} as const satisfies Prisma.MeetingSelect;

export const MEETING_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  matchId: 'Teknik eşleşme bağlantısı; kişi hakkında bilgi taşımaz.',
  mentorUserId: COUNTERPART_ID,
  mentiUserId: COUNTERPART_ID,
  notes: `Görüşme notu / iptal gerekçesi — mentöre özel, menti tarafına gizli. ${KARAR_138}`,
  feedbackPrompted: 'Sistem bayrağı (değerlendirme hatırlatması gönderildi mi); kişinin verisi değil.',
};

/** Kişinin kendi yazdığı değerlendirme (Feedback) — MENTÖR tarafı (KARAR 1 bölümlemesi). */
export const EXPORT_FEEDBACK_AS_MENTOR_SELECT = {
  meetingId: true, tenantId: true,
  preparednessScore: true, proactivityScore: true, engagementScore: true, goalClarityScore: true,
  keyLearnings: true, specificComments: true,
  periodicCareerGrowth: true, periodicTrustScore: true, periodicNetworkScore: true,
  periodicConfidenceScore: true, periodicNpsScore: true,
  createdAt: true, updatedAt: true,
} as const satisfies Prisma.FeedbackSelect;

/** Kişinin kendi yazdığı değerlendirme (Feedback) — MENTİ tarafı (KARAR 1 bölümlemesi). */
export const EXPORT_FEEDBACK_AS_MENTI_SELECT = {
  meetingId: true, tenantId: true,
  guidanceScore: true, resourceSharingScore: true, trustScore: true,
  createdAt: true, updatedAt: true,
} as const satisfies Prisma.FeedbackSelect;

export const FEEDBACK_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  mentorId: COUNTERPART_ID,
  mentiId: COUNTERPART_ID,
  // NOT: karşı tarafın yazdığı puanlar (mentöre: guidance/resourceSharing/trust; mentiye:
  // preparedness…periodic*) diğer tarafın select'inde — KİŞİYE kendi tarafı verilir, karşı tarafın
  // kişi hakkında yazdıkları KARAR-138 ((b)) bekliyor.
};

// ─── Kurum filtresi dışı modeller (src/db.ts TENANT_SCOPED'da yok) ──────────────

/** Kişinin kendi check-in'i (MeetingCheckIn.userId = kişi) — satırın yazarı kişi. */
export const EXPORT_MEETING_CHECK_IN_SELECT = {
  meetingId: true, tenantId: true, role: true,
  overallRating: true, progressRating: true, continueIntent: true, menteePreparedness: true,
  wantedMore: true, nextTopicNote: true, concernTag: true, continuationView: true, openNote: true,
  submittedAt: true,
} as const satisfies Prisma.MeetingCheckInSelect;

export const MEETING_CHECK_IN_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  userId: SELF_ID,
};

/** Kişinin yazdığı eşleşme değerlendirmesi (MatchFeedback.fromUserId = kişi). */
export const EXPORT_MATCH_FEEDBACK_SELECT = {
  matchId: true, checkpoint: true, role: true, progressScore: true, rapportScore: true,
  earlyExit: true, comment: true, createdAt: true,
} as const satisfies Prisma.MatchFeedbackSelect;

export const MATCH_FEEDBACK_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  fromUserId: SELF_ID,
};

/** Kişinin YAPTIĞI şikâyet — yalnız neden/açıklama/tarih (şikâyet edilen kişi ve inceleme eklenmez). */
export const EXPORT_USER_REPORT_SELECT = {
  tenantId: true, reason: true, description: true, createdAt: true,
} as const satisfies Prisma.UserReportSelect;

export const USER_REPORT_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  reporterUserId: SELF_ID,
  targetUserId: `Şikâyet edilen kişinin kimliği. ${COUNTERPART_ID}`,
  status: `Yöneticinin inceleme sonucu. ${KARAR_138}`,
  reviewNote: `Yöneticinin inceleme notu. ${KARAR_138}`,
  reviewedBy: `İnceleyen yöneticinin kimliği. ${KARAR_138}`,
  updatedAt: 'İnceleme sırasında değişen teknik zaman damgası (inceleme sonucu KARAR-138 bekliyor).',
};

const AGREEMENT_BASE_SELECT = {
  tenantId: true, meetingFrequency: true, communicationChannel: true, durationWeeks: true,
  targetMeetings: true, agendaOwner: true, privacyAgreed: true, status: true,
  renewalAskedAt: true, expiresAt: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.MentorshipAgreementSelect;

/** Kişinin MENTÖR olduğu anlaşma: ortak koşullar + kendi onay anı (menti hedefi mentinin verisi). */
export const EXPORT_AGREEMENT_AS_MENTOR_SELECT = {
  ...AGREEMENT_BASE_SELECT, mentorConfirmedAt: true,
} as const satisfies Prisma.MentorshipAgreementSelect;

/** Kişinin MENTİ olduğu anlaşma: ortak koşullar + kendi hedefi + kendi onay anı. */
export const EXPORT_AGREEMENT_AS_MENTI_SELECT = {
  ...AGREEMENT_BASE_SELECT, mentiGoal: true, mentiConfirmedAt: true,
} as const satisfies Prisma.MentorshipAgreementSelect;

export const AGREEMENT_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  mentorId: COUNTERPART_ID,
  mentiId: COUNTERPART_ID,
  matchId: 'Teknik eşleşme bağlantısı; kişi hakkında bilgi taşımaz.',
  // NOT: mentiGoal yalnız MENTİ tarafına, onay anları yalnız kendi tarafına verilir (karşı tarafın verisi).
};

/** Katıldığı konuşmalar — yalnız id/tarih + KENDİ okuma anı (karşı tarafın kimliği/okuma izi yok). */
export const EXPORT_CONVERSATION_AS_MENTOR_SELECT = {
  id: true, tenantId: true, lastMessageAt: true, mentorLastReadAt: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.ConversationSelect;

export const EXPORT_CONVERSATION_AS_MENTI_SELECT = {
  id: true, tenantId: true, lastMessageAt: true, mentiLastReadAt: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.ConversationSelect;

export const CONVERSATION_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  mentorUserId: COUNTERPART_ID,
  mentiUserId: COUNTERPART_ID,
  matchRequestId: 'Teknik bağlantı (konuşmayı açan istek); kişi hakkında bilgi taşımaz.',
  // NOT: karşı tarafın okuma anı (mentor/mentiLastReadAt) yalnız kendi tarafında verilir.
};

/** Kişinin GÖNDERDİĞİ mesajlar (senderUserId = kişi). Aldığı mesajlar KARAR-138 bekliyor. */
// AN-27: zaman önerisi alanları (kind + talep edilen zaman) kişinin KENDİ girdisidir → dışa aktarılır.
export const EXPORT_MESSAGE_SELECT = {
  conversationId: true, content: true, kind: true, proposedStartAt: true, createdAt: true,
} as const satisfies Prisma.MessageSelect;

export const MESSAGE_EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  id: ROW_KEY,
  senderUserId: SELF_ID,
};

// ─── Şema-kapsam kaydı (birim testi okur) ───────────────────────────────────────

type Coverage = { selects: ReadonlyArray<Record<string, unknown>>; excluded: Readonly<Record<string, string>> };

/**
 * Model adı → (dışa aktarma select'leri, gerekçeli hariç listesi). Birden çok select'i olan
 * modellerde (taraf bölümlemesi) alan kümesi select'lerin BİRLEŞİMİDİR; bir alanın hangi tarafa
 * verildiği select sabitinin yorumunda yazılıdır. İlişki alanları şema testinde sayılmaz.
 */
export const OWN_DATA_EXPORT_COVERAGE: Readonly<Record<string, Coverage>> = {
  User: { selects: [EXPORT_PROFILE_SELECT], excluded: PROFILE_EXPORT_EXCLUDED },
  FeedbackLog: {
    selects: [EXPORT_FEEDBACK_LOG_SELECT, EXPORT_FEEDBACK_LOG_AS_AUTHOR_SELECT],
    excluded: FEEDBACK_LOG_EXPORT_EXCLUDED,
  },
  MatchRequest: { selects: [EXPORT_MATCH_REQUEST_SELECT], excluded: MATCH_REQUEST_EXPORT_EXCLUDED },
  UserProfile: { selects: [EXPORT_USER_PROFILE_SELECT], excluded: USER_PROFILE_EXPORT_EXCLUDED },
  MentorFilter: { selects: [EXPORT_MENTOR_FILTER_SELECT], excluded: MENTOR_FILTER_EXPORT_EXCLUDED },
  AvailabilityBlock: { selects: [EXPORT_AVAILABILITY_BLOCK_SELECT], excluded: AVAILABILITY_BLOCK_EXPORT_EXCLUDED },
  ClubMembership: { selects: [EXPORT_CLUB_MEMBERSHIP_SELECT], excluded: CLUB_MEMBERSHIP_EXPORT_EXCLUDED },
  PendingTag: { selects: [EXPORT_PENDING_TAG_SELECT], excluded: PENDING_TAG_EXPORT_EXCLUDED },
  VisibilityOptIn: { selects: [EXPORT_VISIBILITY_OPT_IN_SELECT], excluded: VISIBILITY_OPT_IN_EXPORT_EXCLUDED },
  Meeting: {
    selects: [EXPORT_MEETING_AS_MENTI_SELECT, EXPORT_MEETING_AS_MENTOR_SELECT],
    excluded: MEETING_EXPORT_EXCLUDED,
  },
  Feedback: {
    selects: [EXPORT_FEEDBACK_AS_MENTOR_SELECT, EXPORT_FEEDBACK_AS_MENTI_SELECT],
    excluded: FEEDBACK_EXPORT_EXCLUDED,
  },
  MeetingCheckIn: { selects: [EXPORT_MEETING_CHECK_IN_SELECT], excluded: MEETING_CHECK_IN_EXPORT_EXCLUDED },
  MatchFeedback: { selects: [EXPORT_MATCH_FEEDBACK_SELECT], excluded: MATCH_FEEDBACK_EXPORT_EXCLUDED },
  UserReport: { selects: [EXPORT_USER_REPORT_SELECT], excluded: USER_REPORT_EXPORT_EXCLUDED },
  MentorshipAgreement: {
    selects: [EXPORT_AGREEMENT_AS_MENTOR_SELECT, EXPORT_AGREEMENT_AS_MENTI_SELECT],
    excluded: AGREEMENT_EXPORT_EXCLUDED,
  },
  Conversation: {
    selects: [EXPORT_CONVERSATION_AS_MENTOR_SELECT, EXPORT_CONVERSATION_AS_MENTI_SELECT],
    excluded: CONVERSATION_EXPORT_EXCLUDED,
  },
  Message: { selects: [EXPORT_MESSAGE_SELECT], excluded: MESSAGE_EXPORT_EXCLUDED },
};
