import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { applyFeedbackSignal } from '../services/rewardPenalty.js';
import { logger } from '../services/logger.js';

const DIFFICULTY_VALUES = [
  'ZAMAN_UYUMSUZLUGU',
  'BEKLENTI_FARKI',
  'ILETISIM_TARZI',
  'ULASAMADIM',
] as const;

const GOAL_ACHIEVED_VALUES = ['EVET', 'KISMEN', 'HAYIR'] as const;

const CreateFeedbackLogSchema = z
  .object({
    mentorId: z.string().min(5),
    mentiId: z.string().min(5),
    phase: z.literal(1).or(z.literal(3)),
    starRating: z.number().int().min(1).max(5),
    // Yalnızca düşük puan (1-2) verildiğinde zorunlu
    difficulty: z.enum(DIFFICULTY_VALUES).optional(),
    // Yalnızca 3. ay geri bildirimi için geçerli
    npsScore: z.number().int().min(0).max(10).optional(),
    goalAchieved: z.enum(GOAL_ACHIEVED_VALUES).optional(),
  })
  .refine(
    (d) => d.starRating >= 3 || d.difficulty !== undefined,
    { message: '1 veya 2 yıldız verildiğinde "difficulty" alanı zorunludur.' },
  )
  .refine(
    (d) => d.phase === 1 || (d.npsScore !== undefined && d.goalAchieved !== undefined),
    { message: '3. ay geri bildirimi için "npsScore" ve "goalAchieved" zorunludur.' },
  );

const ListFeedbackLogQuerySchema = z.object({
  mentorId: z.string().optional(),
  mentiId: z.string().optional(),
  phase: z.coerce.number().int().optional(),
});

// POST /api/feedback-logs
export async function createFeedbackLog(req: RequestWithTenant, res: Response) {
  const parsed = CreateFeedbackLogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { mentorId, mentiId, phase, starRating, difficulty, npsScore, goalAchieved } = parsed.data;

  // Mentor ve menti aynı tenant'ta olmalı
  const [mentor, menti] = await Promise.all([
    prisma.user.findFirst({
      where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR' },
      select: { id: true, discType: true },
    }),
    prisma.user.findFirst({
      where: { id: mentiId, tenantId: req.tenant.tenantId, role: 'MENTI' },
      select: { id: true, discType: true },
    }),
  ]);

  if (!mentor) return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  if (!menti)  return res.status(404).json({ error: 'NOT_FOUND', message: 'Menti bulunamadı.' });

  // Her (mentor, menti, faz) ikilisi için yalnızca bir kayıt olabilir (@@unique)
  const log = await prisma.feedbackLog.create({
    data: {
      tenantId: req.tenant.tenantId,
      mentorId: mentor.id,
      mentiId: menti.id,
      phase,
      starRating,
      difficulty: difficulty ?? null,
      npsScore: npsScore ?? null,
      goalAchieved: goalAchieved ?? null,
    },
  });

  // ML sinyal: DISC kombinasyon skorunu ödüllendir ya da cezalandır (senkron — hata görünür olsun)
  try {
    await applyFeedbackSignal({
      tenantId: req.tenant.tenantId,
      mentorDiscType: mentor.discType,
      mentiDiscType: menti.discType,
      starRating,
      phase,
    });
  } catch (err) {
    void logger.error('ML', 'Sinyal uygulanamadı', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Sinyal hatası geri bildirimi engellemez; sadece loglanır.
  }

  return res.status(201).json(log);
}

// GET /api/feedback-logs
// Erişim kuralı (KARAR 1):
//   ADMIN  → tenant geneli (program sağlığı/istatistik için zorunlu)
//   MENTOR → yalnızca kendi yazdığı kayıtlar (mentorId === userId)
//   MENTI  → FeedbackLog'lar mentor tarafından yazılır; menti göremez
export async function listFeedbackLogs(req: RequestWithTenant, res: Response) {
  const parsed = ListFeedbackLogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const role   = req.auth?.role;
  const userId = req.auth?.userId;

  if (role === 'MENTI') {
    return res.json({ items: [], total: 0 });
  }

  const { mentorId, mentiId, phase } = parsed.data;

  // MENTOR: yalnızca kendi kayıtları; dışarıdan gelen mentorId query param'ı görmezden gel
  const effectiveMentorId = role === 'MENTOR' ? userId : mentorId;

  const logs = await prisma.feedbackLog.findMany({
    where: {
      tenantId: req.tenant.tenantId,
      ...(effectiveMentorId && { mentorId: effectiveMentorId }),
      ...(role === 'ADMIN' && mentiId  && { mentiId }),
      ...(phase && { phase }),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      mentor: { select: { id: true, fullName: true, discType: true } },
      menti:  { select: { id: true, fullName: true, discType: true } },
    },
  });

  return res.json({ items: logs, total: logs.length });
}

// GET /api/feedback-logs/:id
export async function getFeedbackLog(req: RequestWithTenant, res: Response) {
  const log = await prisma.feedbackLog.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
    include: {
      mentor: { select: { id: true, fullName: true, discType: true } },
      menti:  { select: { id: true, fullName: true, discType: true } },
    },
  });

  if (!log) return res.status(404).json({ error: 'NOT_FOUND', message: 'Geri bildirim kaydı bulunamadı.' });

  const role   = req.auth?.role;
  const userId = req.auth?.userId;

  // MENTI hiç erişemez; MENTOR yalnızca kendi yazdığı kayda erişebilir
  if (role === 'MENTI') return res.status(403).json({ error: 'YETKISIZ' });
  if (role === 'MENTOR' && log.mentorId !== userId) return res.status(403).json({ error: 'YETKISIZ' });

  return res.json(log);
}

// GET /api/feedback-logs/combination-scores
// Tenant'ın tüm DISC kombinasyon skorlarını döner (ML debug & admin ekranı için)
export async function getCombinationScores(req: RequestWithTenant, res: Response) {
  const scores = await prisma.matchCombinationScore.findMany({
    where: { tenantId: req.tenant.tenantId },
    orderBy: { score: 'desc' },
  });

  return res.json({ items: scores, total: scores.length });
}
