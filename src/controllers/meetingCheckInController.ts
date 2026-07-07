import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { applyFeedbackSignal } from '../services/rewardPenalty.js';
import { logger } from '../services/logger.js';

// ─── Katman 1: Zorunlu kısa değerlendirme ────────────────────────────────────

const CheckInSchema = z.object({
  // Zorunlu
  overallRating:  z.number().int().min(1).max(5),
  progressRating: z.number().int().min(1).max(5),
  continueIntent: z.enum(['EVET', 'BELIRSIZ', 'HAYIR']),

  // Sadece mentor
  menteePreparedness: z.number().int().min(1).max(5).optional(),

  // Katman 2: opsiyonel derinleştirme
  wantedMore:       z.enum(['YONLENDIRME', 'KAYNAK', 'BAGLANIT', 'GERI_BILDIRIM', 'HAYIR']).optional(),
  nextTopicNote:    z.string().max(500).optional(),
  concernTag:       z.enum(['MOT_DUSUK', 'HEDEF_BELIRSIZ', 'ZAMAN_YOK', 'ILETISIM', 'HAYIR']).optional(),
  continuationView: z.enum(['KESINLIKLE', 'EVET', 'KARARSIZ', 'HAYIR']).optional(),
  openNote:         z.string().max(1000).optional(),
});

// POST /api/meetings/:meetingId/check-in
export async function submitCheckIn(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const meetingId = req.params['meetingId'] as string;
  const parsed = CheckInSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, tenantId: req.tenant.tenantId },
    select: {
      id: true, status: true,
      mentorUserId: true, mentiUserId: true,
      mentor: { select: { discType: true } },
      menti:  { select: { discType: true } },
    },
  });

  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND' });
  if (meeting.status !== 'COMPLETED') {
    return res.status(409).json({
      error: 'DURUM_HATASI',
      message: 'Check-in yalnızca tamamlanmış görüşmeler için yapılabilir.',
    });
  }

  const userId = req.auth.userId;
  const isMentor = meeting.mentorUserId === userId;
  const isMenti  = meeting.mentiUserId  === userId;
  if (!isMentor && !isMenti) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const role = isMentor ? 'MENTOR' : 'MENTI';

  const checkIn = await prisma.meetingCheckIn.upsert({
    where: { meetingId_userId: { meetingId, userId } },
    create: {
      meetingId,
      tenantId: req.tenant.tenantId,
      userId,
      role,
      ...parsed.data,
    },
    update: parsed.data,
  });

  // Ödül/ceza sinyali: overallRating düşükse ceza, yüksekse ödül
  void applyFeedbackSignal({
    tenantId:       req.tenant.tenantId,
    mentorDiscType: meeting.mentor.discType,
    mentiDiscType:  meeting.menti.discType,
    starRating:     parsed.data.overallRating,
    phase:          1, // check-in erken sinyal — 1. ay ağırlığı
  }).catch((err) =>
    void logger.error('SYSTEM', 'CheckIn sinyal hatası', {
      message: err instanceof Error ? err.message : String(err),
    }),
  );

  void logger.info('SYSTEM', 'Görüşme check-in kaydedildi', {
    meetingId, userId, role,
    overallRating: parsed.data.overallRating,
    continueIntent: parsed.data.continueIntent,
  });

  return res.status(201).json(checkIn);
}

// GET /api/meetings/:meetingId/check-ins
export async function getCheckIns(req: RequestWithTenant, res: Response) {
  const meetingId = req.params['meetingId'] as string;

  const checkIns = await prisma.meetingCheckIn.findMany({
    where: { meetingId, tenantId: req.tenant.tenantId },
  });

  return res.json({ items: checkIns, total: checkIns.length });
}

// ─── Verimsizlik tespiti: son N check-in'e bakarak çift risk skoru ─────────────

export async function getPairEfficiencySignal(req: RequestWithTenant, res: Response) {
  const { mentorId, mentiId } = req.query as { mentorId?: string; mentiId?: string };
  if (!mentorId || !mentiId) {
    return res.status(400).json({ error: 'mentorId ve mentiId gerekli.' });
  }

  // Bu çiftin son 5 görüşmesindeki check-in'leri çek
  const recentMeetings = await prisma.meeting.findMany({
    where: {
      tenantId:    req.tenant.tenantId,
      mentorUserId: mentorId,
      mentiUserId:  mentiId,
      status:      'COMPLETED',
    },
    orderBy: { startsAt: 'desc' },
    take: 5,
    select: { id: true, startsAt: true },
  });

  if (recentMeetings.length === 0) {
    return res.json({ signal: 'INSUFFICIENT_DATA', meetingCount: 0 });
  }

  const meetingIds = recentMeetings.map((m) => m.id);
  const checkIns = await prisma.meetingCheckIn.findMany({
    where: { meetingId: { in: meetingIds } },
  });

  const avgRating = checkIns.length > 0
    ? checkIns.reduce((s: number, c) => s + c.overallRating, 0) / checkIns.length
    : null;

  const exitIntents = checkIns.filter((c) => c.continueIntent === 'HAYIR').length;

  let signal: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  const reasons: string[] = [];

  if (avgRating !== null && avgRating < 2.5) {
    signal = 'RED';
    reasons.push(`Ortalama puan düşük: ${avgRating.toFixed(1)}/5`);
  } else if (avgRating !== null && avgRating < 3.5) {
    signal = 'YELLOW';
    reasons.push(`Ortalama puan orta: ${avgRating.toFixed(1)}/5`);
  }

  if (exitIntents >= 2) {
    signal = 'RED';
    reasons.push(`${exitIntents} kez "devam etmek istemiyorum" yanıtı`);
  }

  return res.json({
    signal,
    reasons,
    avgRating,
    exitIntents,
    meetingCount: recentMeetings.length,
    checkInCount: checkIns.length,
  });
}
