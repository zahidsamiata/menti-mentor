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

// "HH:MM" → günün dakikası
function timeToMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

// Intl kısa-gün (en-US) → Weekday enum
const PARTS_TO_WEEKDAY: Record<string, Weekday> = {
  Mon: Weekday.MON, Tue: Weekday.TUE, Wed: Weekday.WED, Thu: Weekday.THU,
  Fri: Weekday.FRI, Sat: Weekday.SAT, Sun: Weekday.SUN,
};

// Bir mutlak anı (UTC Date) verilen IANA saat diliminde DUVAR-SAATİ bileşenlerine çevirir.
// Neden: availabilityBlock.startTime/endTime YEREL (blk.timezone, vars. Europe/Istanbul)
// tanımlıdır; müsaitlik penceresi karşılaştırması aynı dilimde yapılmalı. Aksi halde slot'u
// UTC'de projelemek (getUTCHours) İstanbul +03 farkıyla yanlış kabul/ret üretir ve gece
// yarısına yakın günü bile kaydırır. hourCycle:'h23' → gece yarısı "24" sorunu olmaz.
export function zonedWeekdayAndMinutes(
  instant: Date,
  timeZone: string,
): { weekday: Weekday; minutes: number } | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const wd = parts.find((p) => p.type === 'weekday')?.value;
  const hh = parts.find((p) => p.type === 'hour')?.value;
  const mm = parts.find((p) => p.type === 'minute')?.value;
  if (!wd || hh === undefined || mm === undefined) return null;

  const weekday = PARTS_TO_WEEKDAY[wd];
  const hours   = parseInt(hh, 10);
  const minutes = parseInt(mm, 10);
  if (!weekday || Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return { weekday, minutes: hours * 60 + minutes };
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

// Haftalık görüşme limiti — bir hafta = sabit 7 günlük UTC kova (bucket).
// Neden kova, kayan-ileri pencere DEĞİL: yeni görüşmeden İLERİYE 7 gün penceresi, aynı hafta
// içinde DAHA ÖNCE planlanmış görüşmeyi kaçırır (2. görüşme 1.'den saatler sonraysa 1. pencereye
// girmez → limit çalışmaz). Sabit UTC kova, aynı 7-günlük dilimdeki TÜM görüşmeleri (önceki+sonraki)
// birlikte sayar; takvim-haftası saat-dilimi/hafta-başı belirsizliği yoktur (saf UTC ms aritmetiği).
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Limit sayımına DAHİL edilen statüler — aktif/planlı görüşmeler.
// CANCELLED (iptal) ve COMPLETED (tamamlanmış geçmiş görüşme) HARİÇ:
// iptal edilen kotayı tüketmemeli, tamamlanan geçmiş yeni haftayı bloklamamalı.
const LIMIT_COUNTED_STATUSES = [
  MeetingStatus.PENDING,
  MeetingStatus.SCHEDULED,
  MeetingStatus.IN_PROGRESS,
  MeetingStatus.APPROVED,
] as const;

/**
 * Menti başına haftalık görüşme limitini uygular.
 * Limit KİME ait: bir menti (schema.prisma `Tenant.maxMeetingsPerWeek` yorumu:
 * "Bir mentinin haftalık maks. görüşme sayısı").
 *
 * @returns limit aşıldıysa `{ exceeded: true, limit }`, aksi halde `{ exceeded: false }`.
 *          Ayar tanımsız/geçersizse limit UYGULANMAZ (güvenli varsayılan: kısıtlama yok).
 */
async function checkWeeklyMeetingLimit(
  tenantId: string,
  mentiUserId: string,
  newStart: Date,
): Promise<{ exceeded: boolean; limit: number }> {
  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { maxMeetingsPerWeek: true },
  });

  const limit = tenant?.maxMeetingsPerWeek;
  // Ayar yok / geçersiz (≤0) → limit uygulanmaz. (Şema NOT NULL DEFAULT 2 olduğu için
  // pratikte hep dolu; bu yalnızca savunma amaçlı.)
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return { exceeded: false, limit: 0 };
  }

  // Kova: newStart'ın düştüğü sabit 7-günlük UTC dilimi [bucketStart, bucketStart+7g).
  // Aynı kovadaki önceki+sonraki tüm görüşmeler birlikte sayılır.
  const bucketStart = new Date(Math.floor(newStart.getTime() / WEEK_MS) * WEEK_MS);
  const bucketEnd = new Date(bucketStart.getTime() + WEEK_MS);

  const existing = await prisma.meeting.count({
    where: {
      tenantId,
      mentiUserId,
      status:   { in: [...LIMIT_COUNTED_STATUSES] },
      startsAt: { gte: bucketStart, lt: bucketEnd },
    },
  });

  // Yeni görüşme de sayılır: mevcut + 1 > limit ise aşım.
  return { exceeded: existing + 1 > limit, limit };
}

const WEEKLY_LIMIT_MESSAGE = 'Bu hafta için görüşme limitinize ulaştınız.';

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

  // Haftalık görüşme limiti — menti başına (create'den ÖNCE).
  const weekly = await checkWeeklyMeetingLimit(req.tenant.tenantId, menti.id, startsAt);
  if (weekly.exceeded) {
    return res.status(409).json({ error: WEEKLY_LIMIT_MESSAGE });
  }

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
      menti:  { select: { id: true, fullName: true, sectorTags: true, expectationCategories: true } },
      match:  { select: { id: true, predictedScore: true, sectorScore: true, characterScore: true } },
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

  // Yetki (IDOR): route ADMIN|MENTOR'a açık ama bir MENTÖR yalnızca KENDİ görüşmesinin
  // statüsünü değiştirebilmeli. Aksi hâlde başka bir mentör, meetingId tahmin ederek
  // başkasının görüşmesini sahte-tamamlar/iptal eder (ve APPROVED'da onay maili tetikler).
  const isAdmin = req.auth?.role === 'ADMIN';
  if (!isAdmin && req.auth?.userId !== existing.mentorUserId) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca görüşmenin mentörü bu işlemi yapabilir.' });
  }

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

const BookMeetingSchema = z.object({
  mentorUserId:   z.string().min(1),
  matchId:        z.string().optional(),
  format:         z.enum(['ONLINE', 'IN_PERSON', 'PHONE']),
  startsAt:       z.string(),
  endsAt:         z.string(),
  locationUrl:    z.string().optional(),
  locationText:   z.string().optional(),
  phoneNumber:    z.string().optional(),
  requestMessage: z.string()
    .min(50, 'Niyet mesajı en az 50 karakter olmalıdır.')
    .max(500, 'Niyet mesajı en fazla 500 karakter olabilir.'),
});

// 3) bookMeeting — Menti uygun slota görüşme oluşturur (çakışma + müsaitlik kontrollü)
export async function bookMeeting(req: RequestWithTenant, res: Response) {
  const ctx = getCtx(req);
  if (!ctx) return res.status(401).json({ error: 'Kimlik veya tenant bağlamı yok.' });
  const { userId, tenantId } = ctx;

  const parsed = BookMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const {
    matchId, mentorUserId, format,
    startsAt: startsAtRaw, endsAt: endsAtRaw,
    locationUrl, locationText, phoneNumber,
    requestMessage,
  } = parsed.data;

  if (!VALID_FORMATS.includes(format as MeetingFormat)) {
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

  // Müsaitlik şablonu kontrolü — slot, mentörün YEREL (blok saat dilimi) müsaitliğine düşmeli.
  // startsAt/endsAt DB'de mutlak UTC anı olarak saklanır (doğru); yalnızca pencere
  // karşılaştırması blok saat dilimine çevrilir. Gün filtresini UTC'de yapmak da yanlış
  // olurdu (gece yarısı gün kayması) → tüm aktif bloklar çekilir, gün+saat blok diliminde eşlenir.
  const availability = await prisma.availabilityBlock.findMany({
    where: { tenantId, userId: mentorUserId, isActive: true },
  });

  const fitsAvailability = availability.some((blk) => {
    const tz = blk.timezone || 'Europe/Istanbul';
    const s = zonedWeekdayAndMinutes(start, tz);
    const e = zonedWeekdayAndMinutes(end, tz);
    if (!s || !e) return false;
    // Slot, bloğun günü içinde (tek gün) olmalı — yerel güne göre.
    if (s.weekday !== blk.weekday || e.weekday !== blk.weekday) return false;
    const blkS = timeToMinutes(blk.startTime);
    const blkE = timeToMinutes(blk.endTime);
    if (blkS === null || blkE === null) return false;
    return s.minutes >= blkS && e.minutes <= blkE;
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

  // Haftalık görüşme limiti — menti başına (create'den ÖNCE).
  const weekly = await checkWeeklyMeetingLimit(tenantId, userId, start);
  if (weekly.exceeded) {
    return res.status(409).json({ error: WEEKLY_LIMIT_MESSAGE });
  }

  // Toplantı PENDING oluşturulur — mentor onayı beklenir
  const meeting = await prisma.meeting.create({
    data: {
      tenantId,
      matchId:        matchId ?? null,
      mentorUserId,
      mentiUserId:    userId,
      format,
      status:         MeetingStatus.PENDING,
      startsAt:       start,
      endsAt:         end,
      requestMessage,
      locationUrl:    format === MeetingFormat.ONLINE    ? (locationUrl  ?? null) : null,
      locationText:   format === MeetingFormat.IN_PERSON ? (locationText ?? null) : null,
      phoneNumber:    format === MeetingFormat.PHONE     ? (phoneNumber  ?? null) : null,
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
