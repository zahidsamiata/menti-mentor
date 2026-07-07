import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { UserRole, MeetingFormat, MeetingStatus, Weekday } from '@prisma/client';
import { sendMeetingRequestEmail, sendMeetingApprovalEmail } from '../services/emailService.js';
import { logger } from '../services/logger.js';

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

const VALID_WEEKDAYS = Object.values(Weekday);
const VALID_FORMATS  = Object.values(MeetingFormat);

// JS getUTCDay() (0=Pazar) → Weekday enum
const JS_DAY_TO_WEEKDAY: Record<number, Weekday> = {
  0: Weekday.SUN, 1: Weekday.MON, 2: Weekday.TUE,
  3: Weekday.WED, 4: Weekday.THU, 5: Weekday.FRI, 6: Weekday.SAT,
};

// "HH:MM" → günün dakikası
function timeToMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

// [a,b) ∩ [c,d) boş mu?
function rangesOverlap(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

// req.auth + req.tenant bağlamını güvenli oku
function getCtx(req: RequestWithTenant): { userId: string; tenantId: string } | null {
  const userId   = req.auth?.userId;
  const tenantId = req.tenant?.tenantId;
  if (!userId || !tenantId) return null;
  return { userId, tenantId };
}

// ─── Eski handler'lar (mevcut rotalar bunları kullanıyor) ────────────────────

const CreateMeetingSchema = z.object({
  mentorId:    z.string().min(5),
  mentiId:     z.string().min(5),
  scheduledAt: z.string().datetime({ offset: true }),
  endsAt:      z.string().datetime({ offset: true }).optional(),
});

async function checkOrientationLock(mentiId: string, res: Response): Promise<boolean> {
  const menti = await prisma.user.findUnique({
    where:  { id: mentiId },
    select: { needsOrientation: true },
  });
  if (menti?.needsOrientation) {
    res.status(403).json({
      error:   'ORYANTASYON_KILIDI',
      message: 'Bu menti oryantasyon kilidi nedeniyle yeni toplantı oluşturamaz.',
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

  const { mentorId, mentiId, scheduledAt, endsAt } = parsed.data;
  if (await checkOrientationLock(mentiId, res)) return;

  const [mentor, menti] = await Promise.all([
    prisma.user.findFirst({
      where:  { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR', isActive: true },
      select: { id: true, fullName: true, email: true },
    }),
    prisma.user.findFirst({
      where:  { id: mentiId, tenantId: req.tenant.tenantId, role: 'MENTI', isActive: true },
      select: { id: true, fullName: true, email: true },
    }),
  ]);

  if (!mentor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  if (!menti)  return res.status(404).json({ error: 'NOT_FOUND', message: 'Menti bulunamadı.' });

  const startsAt = new Date(scheduledAt);
  const endsAtDate = endsAt
    ? new Date(endsAt)
    : new Date(startsAt.getTime() + 60 * 60 * 1000); // +1 saat varsayılan

  const meeting = await prisma.meeting.create({
    data: {
      tenantId:    req.tenant.tenantId,
      mentorUserId: mentor.id,
      mentiUserId:  menti.id,
      startsAt,
      endsAt: endsAtDate,
    },
  });

  sendMeetingRequestEmail({
    toEmail:    mentor.email,
    mentorName: mentor.fullName,
    mentiName:  menti.fullName,
    scheduledAt: meeting.startsAt,
  }).catch((err: unknown) =>
    logger.warn('EMAIL', 'Toplantı talebi bildirimi gönderilemedi', {
      message: err instanceof Error ? err.message : String(err),
    })
  );

  return res.status(201).json(meeting);
}

const ListMeetingsQuerySchema = z.object({
  mentorId:        z.string().optional(),
  mentiId:         z.string().optional(),
  status:          z.enum(['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'APPROVED', 'COMPLETED', 'CANCELLED']).optional(),
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
      ...(mentorId && { mentorUserId: mentorId }),
      ...(mentiId  && { mentiUserId:  mentiId  }),
      ...(status   && { status }),
      ...(pendingFeedback && { status: 'COMPLETED', hasFeedback: false }),
    },
    orderBy: { startsAt: 'desc' },
    include: {
      mentor: { select: { id: true, fullName: true } },
      menti:  { select: { id: true, fullName: true } },
    },
  });

  return res.json({ items: meetings, total: meetings.length });
}

const UpdateMeetingSchema = z.object({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'APPROVED', 'COMPLETED', 'CANCELLED']),
});

export async function updateMeetingStatus(req: RequestWithTenant, res: Response) {
  const meetingId = req.params['id'] as string;
  const parsed = UpdateMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const existing = await prisma.meeting.findFirst({
    where:   { id: meetingId, tenantId: req.tenant.tenantId },
    include: {
      mentor: { select: { fullName: true, email: true } },
      menti:  { select: { fullName: true, email: true, needsOrientation: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'Toplantı bulunamadı.' });

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data:  { status: parsed.data.status },
  });

  if (parsed.data.status === 'APPROVED') {
    sendMeetingApprovalEmail({
      toEmail:    existing.menti.email,
      mentiName:  existing.menti.fullName,
      mentorName: existing.mentor.fullName,
      scheduledAt: existing.startsAt,
    }).catch((err: unknown) =>
      logger.warn('EMAIL', 'Onay bildirimi gönderilemedi', {
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }

  return res.json(updated);
}

// ─── Yeni handler'lar: Müsaitlik + Akıllı Booking ───────────────────────────

// 1) saveAvailability — Mentör müsaitlik bloklarını kaydeder
export async function saveAvailability(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const { blocks } = req.body as {
    blocks?: Array<{ weekday: Weekday; startTime: string; endTime: string; timezone?: string }>;
  };

  if (!Array.isArray(blocks)) {
    return res.status(400).json({ error: 'blocks bir dizi olmalı.' });
  }

  for (const b of blocks) {
    if (!VALID_WEEKDAYS.includes(b.weekday)) {
      return res.status(400).json({ error: `Geçersiz gün: ${b.weekday}` });
    }
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    if (s === null || e === null) {
      return res.status(400).json({ error: 'Saatler HH:MM formatında olmalı.' });
    }
    if (s >= e) {
      return res.status(400).json({ error: 'Başlangıç saati bitişten önce olmalı.' });
    }
  }

  const membership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId, tenantId } },
    select: { role: true },
  });
  if (!membership || membership.role !== UserRole.MENTOR) {
    return res.status(403).json({ error: 'Yalnızca mentörler müsaitlik tanımlayabilir.' });
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.availabilityBlock.updateMany({
      where: { tenantId, userId, isActive: true },
      data:  { isActive: false },
    });

    if (blocks.length === 0) return [];

    await tx.availabilityBlock.createMany({
      data: blocks.map((b) => ({
        tenantId,
        userId,
        weekday:   b.weekday,
        startTime: b.startTime,
        endTime:   b.endTime,
        timezone:  b.timezone ?? 'Europe/Istanbul',
        isActive:  true,
      })),
    });

    return tx.availabilityBlock.findMany({
      where:   { tenantId, userId, isActive: true },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    });
  });

  return res.status(200).json({ blocks: created });
}

// 2) getAvailability — Bir mentörün aktif müsaitlik bloklarını getirir
export async function getAvailability(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { tenantId } = ctx;

  const mentorUserId = req.query['mentorUserId'] as string | undefined;
  if (!mentorUserId) {
    return res.status(400).json({ error: 'mentorUserId query parametresi gerekli.' });
  }

  const mentorMembership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId: mentorUserId, tenantId } },
    select: { role: true },
  });
  if (!mentorMembership || mentorMembership.role !== UserRole.MENTOR) {
    return res.status(404).json({ error: "Bu tenant'ta böyle bir mentör bulunamadı." });
  }

  const blocks = await prisma.availabilityBlock.findMany({
    where:   { tenantId, userId: mentorUserId, isActive: true },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });

  return res.status(200).json({ mentorUserId, blocks });
}

// 3) bookMeeting — Menti uygun slota görüşme oluşturur (çakışma + müsaitlik kontrollü)
export async function bookMeeting(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const {
    matchId, mentorUserId, format, startsAt: startsAtRaw, endsAt: endsAtRaw,
    locationUrl, locationText, phoneNumber,
  } = req.body as {
    matchId?: string; mentorUserId?: string; format?: MeetingFormat;
    startsAt?: string; endsAt?: string;
    locationUrl?: string; locationText?: string; phoneNumber?: string;
  };

  if (!mentorUserId || !format || !startsAtRaw || !endsAtRaw) {
    return res.status(400).json({ error: 'mentorUserId, format, startsAt, endsAt zorunlu.' });
  }
  if (!VALID_FORMATS.includes(format)) {
    return res.status(400).json({ error: `Geçersiz format: ${format}` });
  }

  const start = new Date(startsAtRaw);
  const end   = new Date(endsAtRaw);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'startsAt/endsAt geçerli ISO tarih olmalı.' });
  }
  if (start >= end) {
    return res.status(400).json({ error: 'Başlangıç bitişten önce olmalı.' });
  }
  if (start.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Geçmiş bir zamana görüşme oluşturulamaz.' });
  }

  // matchId varsa eşleşme doğrulaması
  if (matchId) {
    const match = await prisma.match.findFirst({
      where:   { id: matchId, tenantId },
      include: { mentor: true, menti: true },
    });
    if (!match) return res.status(404).json({ error: 'Eşleşme bulunamadı.' });
    if (match.menti.userId !== userId) {
      return res.status(403).json({ error: 'Bu eşleşme için görüşme oluşturma yetkiniz yok.' });
    }
    if (match.mentor.userId !== mentorUserId) {
      return res.status(400).json({ error: 'mentorUserId bu eşleşmenin mentörüyle uyuşmuyor.' });
    }
  }

  // Müsaitlik şablonu kontrolü
  const weekday  = JS_DAY_TO_WEEKDAY[start.getUTCDay()]!;
  const startMin = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMin   = end.getUTCHours()   * 60 + end.getUTCMinutes();

  const availability = await prisma.availabilityBlock.findMany({
    where: { tenantId, userId: mentorUserId, isActive: true, weekday },
  });

  const fitsAvailability = availability.some((blk) => {
    const blkS = timeToMinutes(blk.startTime);
    const blkE = timeToMinutes(blk.endTime);
    if (blkS === null || blkE === null) return false;
    return startMin >= blkS && endMin <= blkE;
  });

  if (!fitsAvailability) {
    return res.status(409).json({ error: "Seçilen saat mentörün müsaitlik aralığına uymuyor." });
  }

  // Çakışma kontrolü — hem mentör hem menti
  const overlapping = await prisma.meeting.findMany({
    where: {
      tenantId,
      status: { in: [MeetingStatus.SCHEDULED, MeetingStatus.IN_PROGRESS] },
      OR: [{ mentorUserId }, { mentiUserId: userId }],
      startsAt: { lt: end },
      endsAt:   { gt: start },
    },
  });

  if (overlapping.some((m) =>
    rangesOverlap(start.getTime(), end.getTime(), m.startsAt.getTime(), m.endsAt.getTime())
  )) {
    return res.status(409).json({ error: 'Bu saatte taraflardan birinin başka görüşmesi var.' });
  }

  // Toplantı PENDING oluşturulur — mentor onayı beklenir
  const meeting = await prisma.meeting.create({
    data: {
      tenantId,
      matchId:      matchId ?? null,
      mentorUserId,
      mentiUserId:  userId,
      format,
      status:       MeetingStatus.PENDING,
      startsAt:     start,
      endsAt:       end,
      locationUrl:  format === MeetingFormat.ONLINE    ? (locationUrl  ?? null) : null,
      locationText: format === MeetingFormat.IN_PERSON ? (locationText ?? null) : null,
      phoneNumber:  format === MeetingFormat.PHONE     ? (phoneNumber  ?? null) : null,
    },
  });

  // Mentore bildirim: yeni görüşme talebi var
  const { notifyMatchRequestReceived } = await import('../services/notificationService.js');
  void notifyMatchRequestReceived(mentorUserId, tenantId);

  return res.status(201).json({ meeting, awaitingMentorApproval: true });
}

// 4-a) approveMeetingByMentor — Mentor gelen görüşme talebini onaylar
export async function approveMeetingByMentor(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const meetingId = req.params['meetingId'] as string;

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, tenantId, mentorUserId: userId, status: MeetingStatus.PENDING },
    select: { id: true, mentiUserId: true },
  });
  if (!meeting) {
    return res.status(404).json({ error: 'Bekleyen toplantı bulunamadı veya yetkiniz yok.' });
  }

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data:  { status: MeetingStatus.SCHEDULED },
  });

  // Mentiye onay bildirimi
  const { notifyVisibilityApproved } = await import('../services/notificationService.js');
  void notifyVisibilityApproved(meeting.mentiUserId, tenantId);

  return res.json({ meeting: updated });
}

// 4-b) rejectMeetingByMentor — Mentor görüşme talebini reddeder
export async function rejectMeetingByMentor(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const meetingId = req.params['meetingId'] as string;
  const { reason } = req.body as { reason?: string };

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, tenantId, mentorUserId: userId, status: MeetingStatus.PENDING },
    select: { id: true },
  });
  if (!meeting) {
    return res.status(404).json({ error: 'Bekleyen toplantı bulunamadı veya yetkiniz yok.' });
  }

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data:  { status: MeetingStatus.CANCELLED, notes: reason ?? null },
  });

  return res.json({ meeting: updated });
}

// 4) getActiveMeetings — Kullanıcının aktif + yakın geçmiş görüşmeleri
export async function getActiveMeetings(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const since = new Date(Date.now() - 2 * 60 * 60 * 1000); // son 2 saat

  const meetings = await prisma.meeting.findMany({
    where: {
      tenantId,
      OR: [{ mentorUserId: userId }, { mentiUserId: userId }],
      status:  { in: [MeetingStatus.SCHEDULED, MeetingStatus.IN_PROGRESS, MeetingStatus.COMPLETED] },
      endsAt:  { gte: since },
    },
    orderBy: { startsAt: 'asc' },
    include: {
      match: {
        include: {
          mentor: { include: { user: { select: { fullName: true } } } },
          menti:  { include: { user: { select: { fullName: true } } } },
        },
      },
    },
  });

  const payload = meetings.map((m) => ({
    id:              m.id,
    matchId:         m.matchId,
    mentorUserId:    m.mentorUserId,
    mentiUserId:     m.mentiUserId,
    mentorName:      m.match?.mentor.user.fullName ?? undefined,
    mentiName:       m.match?.menti.user.fullName  ?? undefined,
    format:          m.format,
    status:          m.status,
    startsAt:        m.startsAt.toISOString(),
    endsAt:          m.endsAt.toISOString(),
    feedbackPrompted: m.feedbackPrompted,
  }));

  return res.status(200).json({ meetings: payload });
}

// 5) markFeedbackPrompted — Feedback kartı gösterilince tekrar tetiklemeyi önler
export async function markFeedbackPrompted(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const meetingId = req.params['meetingId'] as string;
  if (!meetingId) return res.status(400).json({ error: 'meetingId gerekli.' });

  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      tenantId,
      OR: [{ mentorUserId: userId }, { mentiUserId: userId }],
    },
  });
  if (!meeting) return res.status(404).json({ error: 'Görüşme bulunamadı.' });

  // updateMany: tenantId filtresi ile — update tekil PK'dan daha güvenli
  await prisma.meeting.updateMany({
    where: { id: meetingId, tenantId },
    data:  { feedbackPrompted: true },
  });

  return res.status(200).json({ success: true });
}
