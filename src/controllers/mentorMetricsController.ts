/**
 * Mentör paneli özet metrikleri (salt-okuma).
 *
 * Yalnızca mevcut tablolardan SELECT/count/aggregate yapar — yeni tablo/kolon yok.
 * IDOR: route seviyesinde requireSelfOrAdmin('mentorId') ile korunur; bir mentör
 * yalnızca KENDİ metriğini, ADMIN ise herkesinkini görür.
 */

import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { MeetingStatus } from '@prisma/client';
import { maskNpsSample } from '../services/mask.js';

// "Aktif menti" = mentörle iptal/bekleme dışı (gerçekleşen ya da planlanan) görüşmesi olan menti.
const ACTIVE_MENTI_STATUSES = [
  MeetingStatus.SCHEDULED,
  MeetingStatus.IN_PROGRESS,
  MeetingStatus.COMPLETED,
];

export interface MentorMetricsResponse {
  pendingRequests: number;
  completedMeetings: number;
  activeMentis: number;
  /** AJ-99: yanıt sayısı k-anonimlik eşiğinin altındaysa null (npsSuppressed=true). */
  avgNps: number | null;
  /** AJ-99: ortalama k-anonimlik gereği gizlendi mi (ekran "gizli (<N yanıt)" gösterir). */
  npsSuppressed: boolean;
  /** AJ-99: gizleme eşiği (K_ANONYMITY_THRESHOLD) — ekran metni sabitten kurulsun diye. */
  npsMinSampleSize: number;
  totalMentoringHours: number;
  isCertified: boolean;
  activeMentees: { id: string; fullName: string }[];
}

/**
 * Saf eşleme — DB sonuçlarını panel yanıtına çevirir (DB/HTTP'den arındırılmış, birim test edilebilir).
 * - totalMentoringHours: dakika toplamı saate yuvarlanır (P-11). Veri yoksa 0.
 * - isCertified: üyelik yoksa false (P-12).
 * - activeMentis sayısı ≡ activeMentees liste uzunluğu (P-13; ikisi de aynı groupBy'dan gelir).
 * - avgNps: AJ-99 — kurum ekranlarındaki k-anonimlik kuralı (maskNpsSample, eşik 3) burada da
 *   uygulanır. Tek-iki mentisi olan mentör ortalamadan o kişinin puanını birebir okuyabilirdi;
 *   puanı kimin verdiği bilinirse menti dürüst puan vermekten çekinir. Yanıt sayısı yanıta girmez.
 */
export function buildMentorMetricsResponse(input: {
  pendingRequests: number;
  completedMeetings: number;
  activeMentees: { id: string; fullName: string }[];
  avgNpsRaw: number | null;
  npsSampleSize: number;
  totalDurationMin: number | null;
  isCertified: boolean;
}): MentorMetricsResponse {
  const nps = maskNpsSample({ avgNps: input.avgNpsRaw, sampleSize: input.npsSampleSize });
  return {
    pendingRequests: input.pendingRequests,
    completedMeetings: input.completedMeetings,
    activeMentis: input.activeMentees.length,
    avgNps: nps.avgNps !== null ? Math.round(nps.avgNps) : null,
    npsSuppressed: nps.suppressed,
    npsMinSampleSize: nps.minSampleSize,
    totalMentoringHours: Math.round((input.totalDurationMin ?? 0) / 60),
    isCertified: input.isCertified,
    activeMentees: input.activeMentees,
  };
}

/**
 * GET /mentors/:mentorId/dashboard-metrics
 * Mentör panelindeki özet kartları: bekleyen talepler, tamamlanan görüşme,
 * aktif menti sayısı + listesi, ortalama NPS, toplam mentörlük saati, sertifika
 * durumu. Veri yoksa ilgili alan 0 / [] / false / null döner.
 *
 * P-11: totalMentoringHours — tamamlanan görüşmelerin durationMin toplamı (saat).
 * P-12: isCertified — TenantMembership'ten (sertifika tek kaynak; UserProfile değil).
 * P-13: activeMentees — aktif menti sayacının arkasındaki isim listesi (sayı ≡ liste).
 */
export async function getMentorDashboardMetrics(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;
  const tenantId = req.tenant.tenantId;

  // Kurum izolasyonu (K5-Y3b): requireSelfOrAdmin ADMIN'i her mentorId için geçirir. Hedef
  // mentör İSTEK kurumunda yoksa (başka kurumun ID'si) jenerik 404 — komşu uç
  // POST /mentors/:mentorId/visibility-optin (matchingController.setVisibilityOptIn) ile aynı desen.
  // Önceden sorgular istek kurumuyla filtrelendiği için 200 + sıfır metrik dönüyordu (sızıntı yok
  // ama "mentörün hiç verisi yok" gibi yanıltıcıydı). Kendi metriğine bakan mentör bu kontrole girmez.
  if (req.auth?.userId !== mentorId) {
    const mentor = await prisma.user.findFirst({
      where: { id: mentorId, tenantId },
      select: { id: true },
    });
    if (!mentor) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
    }
  }

  const [pendingRequests, completedMeetings, activeMentiGroups, npsAgg, durationAgg, membership] =
    await Promise.all([
      prisma.meeting.count({
        where: { tenantId, mentorUserId: mentorId, status: MeetingStatus.PENDING },
      }),
      prisma.meeting.count({
        where: { tenantId, mentorUserId: mentorId, status: MeetingStatus.COMPLETED },
      }),
      prisma.meeting.groupBy({
        by: ['mentiUserId'],
        where: { tenantId, mentorUserId: mentorId, status: { in: ACTIVE_MENTI_STATUSES } },
      }),
      // npsScore yalnızca FeedbackLog'ta tutulur (Faz-3 geri bildirimi); Feedback modelinde yoktur.
      prisma.feedbackLog.aggregate({
        where: { tenantId, mentorId, npsScore: { not: null } },
        _avg: { npsScore: true },
        _count: { npsScore: true },
      }),
      // P-11: yalnız tamamlanan görüşmelerin süresi "yapılmış mentörlük" sayılır.
      prisma.meeting.aggregate({
        where: { tenantId, mentorUserId: mentorId, status: MeetingStatus.COMPLETED },
        _sum: { durationMin: true },
      }),
      // P-12: sertifika durumu üyelik bazında tutulur (bkz. adminController.ts:273).
      prisma.tenantMembership.findUnique({
        where: { userId_tenantId: { userId: mentorId, tenantId } },
        select: { isCertified: true },
      }),
    ]);

  // P-13: sayacın arkasındaki menti isimleri (mentör bu isimleri görüşme kartlarında zaten görür).
  const mentiIds = activeMentiGroups.map((g) => g.mentiUserId);
  const activeMentees = mentiIds.length
    ? await prisma.user.findMany({
        where: { id: { in: mentiIds } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      })
    : [];

  return res.json(
    buildMentorMetricsResponse({
      pendingRequests,
      completedMeetings,
      activeMentees,
      avgNpsRaw: npsAgg._avg.npsScore,
      npsSampleSize: npsAgg._count.npsScore,
      totalDurationMin: durationAgg._sum.durationMin,
      isCertified: membership?.isCertified ?? false,
    }),
  );
}
