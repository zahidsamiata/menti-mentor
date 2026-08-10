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

// "Aktif menti" = mentörle iptal/bekleme dışı (gerçekleşen ya da planlanan) görüşmesi olan menti.
const ACTIVE_MENTI_STATUSES = [
  MeetingStatus.SCHEDULED,
  MeetingStatus.IN_PROGRESS,
  MeetingStatus.COMPLETED,
];

/**
 * GET /mentors/:mentorId/dashboard-metrics
 * Mentör panelindeki 4 özet kartı: bekleyen talepler, tamamlanan görüşme,
 * aktif menti sayısı, ortalama NPS. Veri yoksa ilgili alan 0 / null döner.
 */
export async function getMentorDashboardMetrics(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;
  const tenantId = req.tenant.tenantId;

  const [pendingRequests, completedMeetings, activeMentiGroups, npsAgg] = await Promise.all([
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
    }),
  ]);

  return res.json({
    pendingRequests,
    completedMeetings,
    activeMentis: activeMentiGroups.length,
    avgNps: npsAgg._avg.npsScore !== null ? Math.round(npsAgg._avg.npsScore) : null,
  });
}
