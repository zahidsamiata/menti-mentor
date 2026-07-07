import { prisma } from '../db.js';

export type SuggestionSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface CoachingSuggestion {
  code: string;
  severity: SuggestionSeverity;
  title: string;
  description: string;
  actions: string[];
}

/**
 * Kullanıcının tüm metriklerine bakarak yönetici için aksiyon önerileri üretir.
 * Kural bazlı — AI yok, tamamen deterministik.
 */
export async function generateSuggestions(
  userId: string,
  tenantId: string,
): Promise<CoachingSuggestion[]> {
  const suggestions: CoachingSuggestion[] = [];

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true, role: true, fullName: true,
      discType: true, approvalStatus: true,
      needsOrientation: true, rematchCount: true,
      createdAt: true,
    },
  });
  if (!user) return [];

  // ── 1. Uzun süredir görüşme yok ──────────────────────────────────────────
  const daysSinceCreated = Math.floor(
    (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  const recentMeeting = await prisma.meeting.findFirst({
    where: {
      tenantId,
      status: { in: ['SCHEDULED', 'COMPLETED'] },
      OR: [{ mentorUserId: userId }, { mentiUserId: userId }],
    },
    orderBy: { startsAt: 'desc' },
    select: { startsAt: true, status: true },
  });

  const daysSinceMeeting = recentMeeting
    ? Math.floor((Date.now() - recentMeeting.startsAt.getTime()) / (1000 * 60 * 60 * 24))
    : daysSinceCreated;

  if (daysSinceMeeting > 45) {
    suggestions.push({
      code: 'NO_MEETING_45D',
      severity: daysSinceMeeting > 90 ? 'CRITICAL' : 'WARN',
      title: `${daysSinceMeeting} gündür görüşme yapılmadı`,
      description: 'Uzun süre görüşme yoksa eşleşme pasif sayılır, program hedeflerine ulaşılamaz.',
      actions: [
        'Hatırlatma e-postası gönder',
        'Takvimde müsait slot var mı kontrol et',
        'Eşleşmeyi gözden geçir / yeniden eşleştir',
      ],
    });
  }

  // ── 2. Düşük check-in puanı ────────────────────────────────────────────────
  const db = prisma as unknown as {
    meetingCheckIn: {
      findMany: (a: unknown) => Promise<Array<{ overallRating: number; continueIntent: string }>>;
    };
  };
  const recentCheckIns = await db.meetingCheckIn.findMany({
    where: {
      tenantId,
      userId,
    },
  });

  if (recentCheckIns.length >= 2) {
    const avg = recentCheckIns.reduce((s, c) => s + c.overallRating, 0) / recentCheckIns.length;
    const exitCount = recentCheckIns.filter((c) => c.continueIntent === 'HAYIR').length;

    if (avg < 2.5) {
      suggestions.push({
        code: 'LOW_CHECKIN_AVG',
        severity: 'CRITICAL',
        title: `Görüşme kalitesi düşük (ortalama ${avg.toFixed(1)}/5)`,
        description: 'Son görüşme değerlendirmeleri düşük puan gösteriyor.',
        actions: [
          'Kullanıcıyla birebir görüşme planla',
          'Eşleşmeyi sonlandır ve yeniden eşleştir',
          'DISC testini yenilemeyi öner',
        ],
      });
    } else if (avg < 3.5) {
      suggestions.push({
        code: 'MEDIUM_CHECKIN_AVG',
        severity: 'WARN',
        title: `Görüşme kalitesi orta (ortalama ${avg.toFixed(1)}/5)`,
        description: 'Görüşmeler yeterli ama beklentinin altında.',
        actions: [
          'Beklentileri netleştirme görüşmesi öner',
          'Sektör etiketlerini güncellemeyi iste',
        ],
      });
    }

    if (exitCount >= 2) {
      suggestions.push({
        code: 'MULTIPLE_EXIT_INTENTS',
        severity: 'CRITICAL',
        title: `${exitCount} kez "devam etmek istemiyorum" yanıtı`,
        description: 'Kullanıcı birden fazla kez ilişkiyi bitirmek istediğini belirtti.',
        actions: [
          'Yeniden eşleştirmeyi başlat',
          'Kullanıcıyla neden bitmek istediğini konuş',
          'Gerekirse programdan çıkar',
        ],
      });
    }
  }

  // ── 3. Oryantasyon kilidi ─────────────────────────────────────────────────
  if (user.needsOrientation) {
    suggestions.push({
      code: 'ORIENTATION_LOCK',
      severity: 'WARN',
      title: 'Oryantasyon kilidi aktif',
      description: 'Kullanıcı hazırlıksız görüşmeye girdi — sistem kilitli.',
      actions: [
        'Oryantasyon programı tamamlatıldıktan sonra kilidi kaldır',
        'Gerekirse mentörü değiştir',
      ],
    });
  }

  // ── 4. Çok fazla yeniden eşleşme ─────────────────────────────────────────
  if (user.rematchCount >= 3) {
    suggestions.push({
      code: 'HIGH_REMATCH_COUNT',
      severity: 'WARN',
      title: `${user.rematchCount} kez yeniden eşleşme`,
      description: 'Kullanıcı sürekli eşleşme değiştiriyor — profil veya beklenti sorunu olabilir.',
      actions: [
        'Profil etiketlerini gözden geçir',
        'Beklenti kategorilerini güncelle',
        'Danışma görüşmesi planla',
      ],
    });
  }

  // ── 5. DISC profili eksik ─────────────────────────────────────────────────
  if (!user.discType && daysSinceCreated > 14) {
    suggestions.push({
      code: 'DISC_INCOMPLETE',
      severity: 'INFO',
      title: 'DISC profili tamamlanmamış',
      description: `Kayıt üzerinden ${daysSinceCreated} gün geçmesine rağmen test bitmemiş.`,
      actions: [
        'Hatırlatma e-postası gönder',
        'Onboard sürecini gözden geçir',
      ],
    });
  }

  return suggestions;
}
