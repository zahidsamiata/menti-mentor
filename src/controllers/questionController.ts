import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { recalcDiscVector } from '../services/discVectorService.js';
import { logger } from '../services/logger.js';

const CreateQuestionSchema = z.object({
  text: z.string().min(10).max(500),
  type: z.enum(['CORE', 'DEEPENING']).default('CORE'),
  discDimension: z.enum(['D', 'I', 'S', 'C', 'GENERAL']).default('GENERAL'),
  order: z.number().int().min(0).default(0),
  tenantScoped: z.boolean().default(false), // true → bu tenant'a özel
});

const SubmitResponseSchema = z.object({
  responses: z
    .array(z.object({
      questionId: z.string().min(1),
      value: z.number().int().min(1).max(5),
    }))
    .min(1)
    .max(50),
});

// GET /api/questions — aktif soruları döndür (CORE önce, sonra DEEPENING)
export async function listQuestions(req: RequestWithTenant, res: Response) {
  const questions = await prisma.question.findMany({
    where: {
      isActive: true,
      OR: [
        { tenantId: null },                          // global sorular
        { tenantId: req.tenant.tenantId },           // bu tenant'a özel
      ],
    },
    orderBy: [{ type: 'asc' }, { order: 'asc' }],
    select: {
      id: true, text: true, type: true, discDimension: true, order: true, tenantId: true,
    },
  });
  return res.json({ items: questions, total: questions.length });
}

// POST /api/questions — yeni soru oluştur (ADMIN)
export async function createQuestion(req: RequestWithTenant, res: Response) {
  const parsed = CreateQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const { tenantScoped, ...data } = parsed.data;
  const question = await prisma.question.create({
    data: {
      ...data,
      tenantId: tenantScoped ? req.tenant.tenantId : null,
    },
  });
  return res.status(201).json(question);
}

// POST /api/questions/respond — kullanıcı yanıt gönderir, discVector yeniden hesaplanır
export async function submitResponses(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }

  const parsed = SubmitResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const userId = req.auth.userId;
  const { responses } = parsed.data;

  // Tüm soru ID'leri tenant'a erişilebilir mi doğrula
  const questionIds = responses.map((r) => r.questionId);
  const validQuestions = await prisma.question.findMany({
    where: {
      id: { in: questionIds },
      isActive: true,
      OR: [{ tenantId: null }, { tenantId: req.tenant.tenantId }],
    },
    select: { id: true },
  });
  const validIds = new Set(validQuestions.map((q) => q.id));
  const invalidIds = questionIds.filter((id) => !validIds.has(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: 'GECERSIZ_SORU', message: `Geçersiz soru ID'leri: ${invalidIds.join(', ')}` });
  }

  // Upsert — aynı soru için tekrar yanıt gelirse güncelle
  await prisma.$transaction(
    responses.map((r) =>
      prisma.userResponse.upsert({
        where: { userId_questionId: { userId, questionId: r.questionId } },
        create: { userId, questionId: r.questionId, value: r.value },
        update: { value: r.value },
      }),
    ),
  );

  // discVector yeniden hesapla
  const vector = await recalcDiscVector(userId);

  void logger.info('SYSTEM', `discVector yeniden hesaplandı`, {
    userId,
    confidence: vector.confidence,
    vector: { D: vector.D, I: vector.I, S: vector.S, C: vector.C },
  });

  return res.json({
    message: `${responses.length} yanıt kaydedildi. Profil güncellendi.`,
    discVector: vector,
  });
}

// GET /api/questions/my-responses — kullanıcının kendi yanıtları + kalan soru sayısı
export async function getMyResponses(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const userId = req.auth.userId;

  const [totalQuestions, answered] = await Promise.all([
    prisma.question.count({
      where: {
        isActive: true,
        OR: [{ tenantId: null }, { tenantId: req.tenant.tenantId }],
      },
    }),
    prisma.userResponse.findMany({
      where: { userId },
      select: { questionId: true, value: true },
    }),
  ]);

  const answeredIds = new Set(answered.map((r) => r.questionId));
  const remaining = totalQuestions - answeredIds.size;
  const completionRate = totalQuestions > 0 ? Math.round((answeredIds.size / totalQuestions) * 100) : 0;

  return res.json({ answered: answered.length, total: totalQuestions, remaining, completionRate });
}
