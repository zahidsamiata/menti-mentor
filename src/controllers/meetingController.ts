import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { sendMeetingRequestEmail, sendMeetingApprovalEmail } from '../services/emailService.js';
import { logger } from '../services/logger.js';

const CreateMeetingSchema = z.object({
  mentorId: z.string().min(5),
  mentiId: z.string().min(5),
  scheduledAt: z.string().datetime({ offset: true }),
});

// Menti oryantasyon kilidini kontrol eder; kilitliyse 403 döner.
async function checkOrientationLock(mentiId: string, res: Response): Promise<boolean> {
  const menti = await prisma.user.findUnique({
    where: { id: mentiId },
    select: { needsOrientation: true },
  });
  if (menti?.needsOrientation) {
    res.status(403).json({
      error: 'ORYANTASYON_KILIDI',
      message: 'Bu menti, hazırlık puanı düşük olduğu için yeni toplantı ayarlayamaz. Oryantasyon kilidi yönetici tarafından kaldırılmalıdır.',
    });
    return true;
  }
  return false;
}

export async function createMeeting(req: RequestWithTenant, res: Response) {
  const parsed = CreateMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { mentorId, mentiId, scheduledAt } = parsed.data;

  // Oryantasyon kilidi kontrolü
  if (await checkOrientationLock(mentiId, res)) return;

  const [mentor, menti] = await Promise.all([
    prisma.user.findFirst({
      where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR', isActive: true },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.user.findFirst({
      where: { id: mentiId, tenantId: req.tenant.tenantId, role: 'MENTI', isActive: true },
      select: { id: true, fullName: true, email: true },
    }),
  ]);

  if (!mentor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  if (!menti)  return res.status(404).json({ error: 'NOT_FOUND', message: 'Menti bulunamadı.' });

  const meeting = await prisma.meeting.create({
    data: {
      tenantId: req.tenant.tenantId,
      mentorId: mentor.id,
      mentiId: menti.id,
      scheduledAt: new Date(scheduledAt),
    },
  });

  // Mentor'a e-posta bildirimi (hata toplantıyı bloke etmemeli)
  sendMeetingRequestEmail({
    toEmail: mentor.email,
    mentorName: mentor.fullName,
    mentiName: menti.fullName,
    scheduledAt: meeting.scheduledAt,
  }).catch((err: unknown) =>
    logger.warn('EMAIL', 'Toplantı talebi bildirimi gönderilemedi', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  );

  return res.status(201).json(meeting);
}

const ListMeetingsQuerySchema = z.object({
  mentorId: z.string().optional(),
  mentiId: z.string().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED']).optional(),
  pendingFeedback: z.string().optional().transform((v) => v === 'true'),
});

export async function listMeetings(req: RequestWithTenant, res: Response) {
  const parsed = ListMeetingsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { mentorId, mentiId, status, pendingFeedback } = parsed.data;

  const meetings = await prisma.meeting.findMany({
    where: {
      tenantId: req.tenant.tenantId,
      ...(mentorId && { mentorId }),
      ...(mentiId && { mentiId }),
      ...(status && { status }),
      // Bekleyen geri bildirim: tamamlandı ama feedback verilmedi
      ...(pendingFeedback && { status: 'COMPLETED', hasFeedback: false }),
    },
    orderBy: { scheduledAt: 'desc' },
    include: {
      mentor: { select: { id: true, fullName: true } },
      menti: { select: { id: true, fullName: true } },
    },
  });

  return res.json({ items: meetings, total: meetings.length });
}

const UpdateMeetingSchema = z.object({
  status: z.enum(['APPROVED', 'COMPLETED', 'CANCELLED']),
});

export async function updateMeetingStatus(req: RequestWithTenant, res: Response) {
  const meetingId = req.params['id'] as string;
  const parsed = UpdateMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const existing = await prisma.meeting.findFirst({
    where: { id: meetingId, tenantId: req.tenant.tenantId },
    include: {
      mentor: { select: { fullName: true, email: true } },
      menti: { select: { fullName: true, email: true, needsOrientation: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Toplantı bulunamadı.' });

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: parsed.data.status },
  });

  // Onay durumunda mentiye e-posta gönder
  if (parsed.data.status === 'APPROVED') {
    sendMeetingApprovalEmail({
      toEmail: existing.menti.email,
      mentiName: existing.menti.fullName,
      mentorName: existing.mentor.fullName,
      scheduledAt: existing.scheduledAt,
    }).catch((err: unknown) =>
      logger.warn('EMAIL', 'Onay bildirimi gönderilemedi', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
  }

  return res.json(updated);
}
