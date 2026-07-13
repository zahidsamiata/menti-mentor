import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { sendFeedbackReminderEmail } from '../services/emailService.js';
import { logger } from '../services/logger.js';

const FeedbackSchema = z.object({
  // Menti → Mentor (1-5)
  guidanceScore: z.number().int().min(1).max(5).optional(),
  resourceSharingScore: z.number().int().min(1).max(5).optional(),
  trustScore: z.number().int().min(1).max(5).optional(),
  // Mentor → Menti (1-5)
  preparednessScore: z.number().int().min(1).max(5).optional(),
  proactivityScore: z.number().int().min(1).max(5).optional(),
  // Nitel
  keyLearnings: z.string().max(1000).optional(),
  specificComments: z.string().max(1000).optional(),
}).refine(
  (d) =>
    d.guidanceScore !== undefined ||
    d.resourceSharingScore !== undefined ||
    d.trustScore !== undefined ||
    d.preparednessScore !== undefined ||
    d.proactivityScore !== undefined,
  { message: 'En az bir değerlendirme puanı girilmelidir.' },
);

export async function submitFeedback(req: RequestWithTenant, res: Response) {
  const meetingId = req.params['meetingId'] as string;
  const parsed = FeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, tenantId: req.tenant.tenantId },
    select: { id: true, status: true, mentorUserId: true, mentiUserId: true, hasFeedback: true },
  });
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND', message: 'Toplantı bulunamadı.' });
  if (meeting.status !== 'COMPLETED') {
    return res.status(409).json({ error: 'DURUM_HATASI', message: 'Geri bildirim yalnızca tamamlanmış toplantılar için verilebilir.' });
  }
  if (meeting.hasFeedback) {
    return res.status(409).json({ error: 'ZATEN_MEVCUT', message: 'Bu toplantı için geri bildirim zaten gönderildi.' });
  }

  const data = parsed.data;

  // Geri bildirimi kaydet ve toplantıyı işaretle (transaction)
  const [feedback] = await prisma.$transaction([
    prisma.feedback.create({
      data: {
        meetingId,
        tenantId: req.tenant.tenantId,
        mentorId: meeting.mentorUserId,
        mentiId:  meeting.mentiUserId,
        guidanceScore: data.guidanceScore,
        resourceSharingScore: data.resourceSharingScore,
        trustScore: data.trustScore,
        preparednessScore: data.preparednessScore,
        proactivityScore: data.proactivityScore,
        keyLearnings: data.keyLearnings,
        specificComments: data.specificComments,
      },
    }),
    // updateMany: tenantId filtresi ile çift güvenlik (update tekil PK'dan daha güvenli)
    prisma.meeting.updateMany({
      where: { id: meetingId, tenantId: req.tenant.tenantId },
      data: { hasFeedback: true },
    }),
  ]);

  // Oryantasyon kilidi: hazırlık puanı <= 2 ise kilitle
  if (data.preparednessScore !== undefined && data.preparednessScore <= 2) {
    await prisma.user.update({
      where: { id: meeting.mentiUserId },
      data: { needsOrientation: true },
    });
    void logger.warn('SYSTEM', `Menti oryantasyon kilidi uygulandı`, {
      mentiId: meeting.mentiUserId,
      preparednessScore: data.preparednessScore,
    });
  }

  return res.status(201).json(feedback);
}

export async function getMeetingFeedback(req: RequestWithTenant, res: Response) {
  const meetingId = req.params['meetingId'] as string;

  const feedback = await prisma.feedback.findUnique({
    where: { meetingId },
    include: {
      meeting: { select: { tenantId: true, mentorUserId: true, mentiUserId: true } },
    },
  });

  if (!feedback || feedback.meeting.tenantId !== req.tenant.tenantId) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Geri bildirim bulunamadı.' });
  }

  const userId  = req.auth?.userId;
  const role    = req.auth?.role;
  const isMentor = feedback.meeting.mentorUserId === userId;
  const isMenti  = feedback.meeting.mentiUserId  === userId;
  const isAdmin  = role === 'ADMIN';

  if (!isMentor && !isMenti && !isAdmin) {
    return res.status(403).json({ error: 'YETKISIZ' });
  }

  // KARAR 1: Taraflar yalnızca KENDİ yazdıklarını görür; karşı tarafın değerlendirmesi gizlenir.
  // Mentor → Menti alanları: preparednessScore, proactivityScore, engagementScore,
  //   goalClarityScore, keyLearnings, specificComments, periodic* alanları.
  // Menti → Mentor alanları: guidanceScore, resourceSharingScore, trustScore.
  if (isAdmin) {
    return res.json(feedback);
  }

  const { meeting: _m, ...base } = feedback;

  if (isMentor) {
    const { guidanceScore: _g, resourceSharingScore: _r, trustScore: _t, ...mentorView } = base;
    return res.json(mentorView);
  }

  // isMenti: yalnızca menti → mentor alanları
  const {
    preparednessScore: _p, proactivityScore: _pr, engagementScore: _e, goalClarityScore: _gc,
    keyLearnings: _kl, specificComments: _sc,
    periodicCareerGrowth: _pcg, periodicTrustScore: _pts,
    periodicNetworkScore: _pns, periodicConfidenceScore: _pcs, periodicNpsScore: _pnps,
    ...mentiView
  } = base;
  return res.json(mentiView);
}

// Admin: oryantasyon kilidini kaldırır (örn. mentor onayı veya program tamamlama sonrası)
export async function clearOrientationLock(req: RequestWithTenant, res: Response) {
  const userId = req.params['userId'] as string;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId, role: 'MENTI' },
    select: { id: true, fullName: true, needsOrientation: true },
  });
  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Menti bulunamadı.' });
  if (!user.needsOrientation) {
    return res.status(409).json({ error: 'ZAT_ACIK', message: 'Kullanıcının oryantasyon kilidi zaten açık.' });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { needsOrientation: false },
    select: { id: true, fullName: true, needsOrientation: true },
  });

  return res.json({ message: `${user.fullName} kullanıcısının oryantasyon kilidi kaldırıldı.`, user: updated });
}

// Geri bildirim bekleyen tamamlanmış toplantıları sorgula ve hatırlatma e-postası gönder
export async function sendPendingFeedbackReminders(req: RequestWithTenant, res: Response) {
  const pendingMeetings = await prisma.meeting.findMany({
    where: { tenantId: req.tenant.tenantId, status: 'COMPLETED', hasFeedback: false },
    include: {
      mentor: { select: { fullName: true, email: true } },
      menti: { select: { fullName: true, email: true } },
    },
  });

  let sent = 0;
  for (const m of pendingMeetings) {
    await sendFeedbackReminderEmail({
      toEmail: m.mentor.email,
      recipientName: m.mentor.fullName,
      meetingId: m.id,
      scheduledAt: m.startsAt,
    }).catch(() => null);
    await sendFeedbackReminderEmail({
      toEmail: m.menti.email,
      recipientName: m.menti.fullName,
      meetingId: m.id,
      scheduledAt: m.startsAt,
    }).catch(() => null);
    sent++;
  }

  return res.json({ message: `${sent} toplantı için hatırlatma e-postası gönderildi.`, count: sent });
}
