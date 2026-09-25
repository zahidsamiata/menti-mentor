import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { sendFeedbackReminderEmail } from '../services/emailService.js';
import { persistMentorQualityMultiplier } from '../services/scoring.js';
import { logger } from '../services/logger.js';
import { validateRequest } from '../middleware/validate.js';

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
  const parsed = validateRequest(FeedbackSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, tenantId: req.tenant.tenantId },
    select: { id: true, status: true, mentorUserId: true, mentiUserId: true, hasFeedback: true },
  });
  if (!meeting) return res.status(404).json({ error: 'NOT_FOUND', message: 'Toplantı bulunamadı.' });

  // SAHİPLİK (güvenlik): yazma yolunda taraf kontrolü EKSİKTİ — kimliği doğrulanmış herhangi
  // bir kullanıcı, tarafı olmadığı bir görüşmeye değerlendirme yazıp mentörün kalıcı kalite
  // katsayısını düşürebiliyor, mentiye oryantasyon kilidi bastırabiliyor ve hasFeedback
  // bayrağını yakarak gerçek tarafların yazmasını engelleyebiliyordu.
  // Desen: aynı dosyadaki OKUMA ucu (getFeedback) ile birebir aynı taraf kontrolü.
  // Fark (bilinçli): okuma ADMIN'e açıktır, YAZMA değildir — değerlendirme yalnız taraflarındır.
  // Kontrol, HİÇBİR yazma yapılmadan ÖNCE çalışır (hasFeedback · kalite katsayısı · kilit).
  const authUserId = req.auth?.userId;
  const isMentor   = meeting.mentorUserId === authUserId;
  const isMenti    = meeting.mentiUserId  === authUserId;
  if (!isMentor && !isMenti) {
    return res.status(403).json({
      error:   'YETKISIZ',
      message: 'Yalnızca görüşmenin tarafları değerlendirme yazabilir.',
    });
  }

  if (meeting.status !== 'COMPLETED') {
    return res.status(409).json({ error: 'DURUM_HATASI', message: 'Geri bildirim yalnızca tamamlanmış toplantılar için verilebilir.' });
  }
  if (meeting.hasFeedback) {
    return res.status(409).json({ error: 'ZATEN_MEVCUT', message: 'Bu toplantı için geri bildirim zaten gönderildi.' });
  }

  const data = parsed.data;

  // ROL KAYITTAN (güvenlik): değerlendirenin yönü istekten değil, görüşme kaydından çıkarılır.
  // Alan bölümlemesi okuma ucundaki (getFeedback) bölümlemenin aynısıdır:
  //   mentör → menti: preparedness · proactivity · keyLearnings · specificComments
  //   menti  → mentör: guidance · resourceSharing · trust
  // Aksi hâlde bir mentör kendi kalite katsayısını besleyen puanları KENDİSİ yazabilir,
  // bir menti kendine oryantasyon kilidi bastırabilirdi.
  const mentiSideSent =
    data.guidanceScore !== undefined ||
    data.resourceSharingScore !== undefined ||
    data.trustScore !== undefined;
  const mentorSideSent =
    data.preparednessScore !== undefined ||
    data.proactivityScore !== undefined ||
    data.keyLearnings !== undefined ||
    data.specificComments !== undefined;

  if (isMentor && mentiSideSent) {
    return res.status(403).json({
      error:   'YETKISIZ_ALAN',
      message: 'Mentör, mentinin mentöre verdiği puanları gönderemez.',
    });
  }
  if (isMenti && mentorSideSent) {
    return res.status(403).json({
      error:   'YETKISIZ_ALAN',
      message: 'Menti, mentörün mentiye verdiği puanları gönderemez.',
    });
  }

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

  // Kalite katsayısını KALICI yaz (event-driven): menti→mentör puanları (guidance/
  // resourceSharing/trust) geldiyse mentörün kalıcı kalite puanını yeniden hesaplayıp yaz.
  // Non-fatal (best-effort): başarısız olsa da feedback kaydı ve response bozulmaz.
  const hasMentorRating =
    data.guidanceScore !== undefined ||
    data.resourceSharingScore !== undefined ||
    data.trustScore !== undefined;
  if (hasMentorRating) {
    void persistMentorQualityMultiplier(meeting.mentorUserId, req.tenant.tenantId).catch((err) =>
      void logger.error('SYSTEM', 'Kalite katsayısı persist hatası', {
        mentorId: meeting.mentorUserId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

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

// V-07: hatırlatma gönderimi SMTP burst koruması.
// Bu uç ADMIN elle tetikliyor; eskiden her çağrıda bekleyen TÜM toplantılara (2 mail/toplantı)
// batch/cooldown olmadan mail atıyordu → admin arka arkaya tıklayınca kurum spam'lenir, SMTP
// itibarı yanardı. Şema alanı EKLEMEDEN (migration'sız): (1) çağrı başına batch tavanı,
// (2) toplantı başına in-memory cooldown — süre içinde tekrar tetiklense de yeniden gönderilmez.
// In-memory olması best-effort'tur (restart'ta sıfırlanır) ama tek oturumda tekrarlı tıklamayı keser.
// Eşikler çağrı anında okunur (test kendi eşiğini ayarlayabilsin).
const lastReminderByMeeting = new Map<string, number>();

/** Test yardımcısı — cooldown durumunu sıfırlar (yalnız testlerde kullanılır). */
export function resetFeedbackReminderCooldown(): void {
  lastReminderByMeeting.clear();
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

  const batchLimit = Number(process.env['FEEDBACK_REMINDER_BATCH_LIMIT'] ?? 100);
  const cooldownMs = Number(process.env['FEEDBACK_REMINDER_COOLDOWN_MS'] ?? 20 * 60 * 60 * 1000); // 20 saat
  const now = Date.now();
  // Cooldown süresi içinde son kez hatırlatılan toplantıları ele.
  const eligible = pendingMeetings.filter((m) => {
    const last = lastReminderByMeeting.get(m.id);
    return last === undefined || now - last >= cooldownMs;
  });
  const skippedCooldown = pendingMeetings.length - eligible.length;
  // Çağrı başına batch tavanı — kalan sonraki çağrıda işlenir.
  const batch = eligible.slice(0, batchLimit);
  const remaining = eligible.length - batch.length;

  // U-16: "gönderildi" artık gerçek teslimi yansıtır. count = işlenen (batch/cooldown
  // muhasebesi), delivered = en az bir tarafa (mentör/menti) gerçekten giden mail sayısı.
  let attempted = 0;
  let delivered = 0;
  for (const m of batch) {
    const mentorOk = await sendFeedbackReminderEmail({
      toEmail: m.mentor.email,
      recipientName: m.mentor.fullName,
      meetingId: m.id,
      scheduledAt: m.startsAt,
    }).catch(() => false);
    const mentiOk = await sendFeedbackReminderEmail({
      toEmail: m.menti.email,
      recipientName: m.menti.fullName,
      meetingId: m.id,
      scheduledAt: m.startsAt,
    }).catch(() => false);
    // Cooldown işleme anında kurulur (anti-spam: aynı oturumda tekrar tetikleme kesilir).
    lastReminderByMeeting.set(m.id, now);
    attempted++;
    if (mentorOk || mentiOk) delivered++;
  }

  const failed = attempted - delivered;
  return res.json({
    message: `${delivered} toplantı için hatırlatma e-postası gönderildi${
      failed > 0 ? ` (${failed} toplantıya gönderilemedi).` : '.'
    }`,
    count: attempted,
    delivered,
    skippedCooldown,
    remaining,
  });
}
