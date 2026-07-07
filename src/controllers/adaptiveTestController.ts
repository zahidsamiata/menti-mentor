import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { getNextQuestion, previewDiscVector } from '../services/adaptiveTestEngine.js';

// ─── Sonraki soru ─────────────────────────────────────────────────────────────

/**
 * GET /users/:id/adaptive-test/next
 * Kullanıcının mevcut yanıt geçmişine göre sıradaki soruyu döndürür.
 * Test tamamlandıysa hesaplanan DISC vektörünü döndürür.
 */
export async function getNextAdaptiveQuestion(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  // Yetki: kullanıcı kendi testini veya admin görebilir
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Kimlik doğrulaması gerekli.' });
  }
  const isSelf = req.auth.userId === userId;
  const isAdmin = req.auth.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  const result = await getNextQuestion(userId, req.tenant.tenantId);
  return res.json(result);
}

// ─── Yanıt gönder ─────────────────────────────────────────────────────────────

const SubmitAnswerSchema = z.object({
  questionId: z.string().min(5),
  value: z.number().int().min(1).max(5),
});

/**
 * POST /users/:id/adaptive-test/answer
 * Tek bir soru yanıtını kaydeder ve bir sonraki soruyu döndürür.
 */
export async function submitAdaptiveAnswer(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });
  }
  const isSelf = req.auth.userId === userId;
  const isAdmin = req.auth.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const parsed = SubmitAnswerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  // Sorunun var olup olmadığını doğrula
  const question = await prisma.question.findFirst({
    where: {
      id: parsed.data.questionId,
      isActive: true,
      OR: [{ tenantId: req.tenant.tenantId }, { tenantId: null }],
    },
    select: { id: true },
  });
  if (!question) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Soru bulunamadı.' });
  }

  // Upsert — aynı soruya birden fazla yanıt gelirse günceller
  await prisma.userResponse.upsert({
    where: { userId_questionId: { userId, questionId: parsed.data.questionId } },
    update: { value: parsed.data.value },
    create: { userId, questionId: parsed.data.questionId, value: parsed.data.value },
  });

  // Bir sonraki soruyu hesapla
  const nextResult = await getNextQuestion(userId, req.tenant.tenantId);
  return res.json(nextResult);
}

// ─── Anlık DISC önizleme ──────────────────────────────────────────────────────

/**
 * GET /users/:id/adaptive-test/preview
 * Tamamlanmadan önce anlık DISC vektörü tahmini döndürür.
 * Compliance Note: Analytical veri — PII içermez.
 */
export async function previewAdaptiveResult(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });
  }
  const isSelf = req.auth.userId === userId;
  const isAdmin = req.auth.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const vector = await previewDiscVector(userId);
  return res.json({ discVector: vector, note: 'Bu bir anlık tahmindir; test tamamlandığında güncellenir.' });
}
