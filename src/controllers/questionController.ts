/**
 * Soru Havuzu ve Adaptif Test Controller
 *
 * Sorumluluk: HTTP katmanı — istek doğrulama, yanıt biçimlendirme.
 * İş mantığı: questionService.ts ve discVectorService.ts'e delege edilir.
 *
 * Endpoint haritası:
 *   GET  /api/questions                   → listQuestions   (soruları + pool meta verisini döner)
 *   POST /api/questions                   → createQuestion  (ADMIN — soru ekle)
 *   POST /api/questions/:questionId/respond → respondToQuestion (tek soru yanıtı)
 *   POST /api/questions/respond            → submitResponses  (toplu yanıt — ileride kullanım)
 *   GET  /api/questions/my-responses       → getMyResponses  (tamamlanma durumu)
 *
 * Neden iki respond endpoint'i var?
 *   - Tek soru (:questionId/respond): frontend tarafından kullanılır; her cevap
 *     anında kaydedilir ve gerçek zamanlı ilerleme döner.
 *   - Toplu respond: toplu import veya proje içi kullanım için saklanır.
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { recalcDiscVector, invalidateDimensionalCountCache } from '../services/discVectorService.js';
import { logger } from '../services/logger.js';
import {
  buildQuestionList,
  calcAdaptiveProgress,
  upsertSingleResponse,
  validateQuestionIds,
} from '../services/questionService.js';

// ─── Validasyon şemaları ──────────────────────────────────────────────────────

const CreateQuestionSchema = z.object({
  text: z.string().min(10).max(500),
  type: z.enum(['CORE', 'DEEPENING']).default('CORE'),
  discDimension: z.enum(['D', 'I', 'S', 'C', 'GENERAL']).default('GENERAL'),
  order: z.number().int().min(0).default(0),
  /** true: yalnızca bu tenant'a özgü soru; false: tüm tenantlara görünür (global) */
  tenantScoped: z.boolean().default(false),
});

const SingleResponseSchema = z.object({
  value: z.number().int().min(1).max(5),
});

const BatchResponseSchema = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.number().int().min(1).max(5),
      }),
    )
    .min(1)
    .max(50),
});

// ─── GET /api/questions ───────────────────────────────────────────────────────

/**
 * Tenant'a erişilebilir aktif soruları + havuz meta verisini döner.
 *
 * meta.coreThreshold: frontend bu değeri kullanarak DEEPENING geçişini belirler.
 * Sabit bir eşik yerine DB'den dinamik hesaplanır — admin-proof.
 */
export async function listQuestions(req: RequestWithTenant, res: Response) {
  const { questions, meta } = await buildQuestionList(req.tenant.tenantId);
  return res.json({ items: questions, total: questions.length, meta });
}

// ─── POST /api/questions ──────────────────────────────────────────────────────

/** Admin: yeni soru oluştur. tenantScoped=true → yalnızca bu tenant'a görünür. */
export async function createQuestion(req: RequestWithTenant, res: Response) {
  const parsed = CreateQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const { tenantScoped, ...data } = parsed.data;

  const { prisma } = await import('../db.js');
  const question = await prisma.question.create({
    data: { ...data, tenantId: tenantScoped ? req.tenant.tenantId : null },
  });
  // Yeni soru eklenince confidence hedefi değişir — cache'i invalidate et
  invalidateDimensionalCountCache();
  return res.status(201).json(question);
}

// ─── POST /api/questions/:questionId/respond ─────────────────────────────────

/**
 * Tek soru yanıtı — frontend tarafından her soru geçişinde çağrılır.
 *
 * Akış:
 *   1. questionId geçerliliğini doğrula (tenant erişimi + aktif)
 *   2. Yanıtı kaydet (idempotent upsert)
 *   3. discVector'ü yeniden hesapla
 *   4. Güncel adaptif ilerlemeyi döner
 *
 * Frontend bu yanıttaki `progress` nesnesini kullanarak faz kararı verir.
 * Client-side eşik sabiti gerekmez.
 */
export async function respondToQuestion(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }

  const questionId = req.params['questionId'] as string;
  const parsed = SingleResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  // Soru bu tenant'a erişilebilir mi?
  const invalidIds = await validateQuestionIds([questionId], req.tenant.tenantId);
  if (invalidIds.length > 0) {
    return res.status(404).json({ error: 'SORU_BULUNAMADI', message: 'Soru bulunamadı veya erişim reddedildi.' });
  }

  const userId = req.auth.userId;

  // Yanıtı kaydet + vektörü güncelle (paralel değil — vektör hesabı yanıt sonrası)
  await upsertSingleResponse(userId, questionId, parsed.data.value);
  const [discVector, progress] = await Promise.all([
    recalcDiscVector(userId),
    calcAdaptiveProgress(userId, req.tenant.tenantId),
  ]);

  void logger.info('SYSTEM', 'Soru yanıtlandı, discVector güncellendi', {
    userId,
    questionId,
    confidence: discVector.confidence,
    isDeepening: progress.isDeepening,
    completionPercent: progress.completionPercent,
  });

  return res.json({ discVector, progress });
}

// ─── POST /api/questions/respond (toplu) ────────────────────────────────────

/**
 * Toplu yanıt — proje içi ve veri migration kullanımı için saklanır.
 * Normal test akışında kullanılmaz; tekil endpoint (/:questionId/respond) tercih edilir.
 */
export async function submitResponses(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }

  const parsed = BatchResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { responses } = parsed.data;
  const questionIds = responses.map((r) => r.questionId);
  const invalidIds = await validateQuestionIds(questionIds, req.tenant.tenantId);
  if (invalidIds.length > 0) {
    return res.status(400).json({
      error: 'GECERSIZ_SORU',
      message: `Geçersiz soru ID'leri: ${invalidIds.join(', ')}`,
    });
  }

  const userId = req.auth.userId;

  const { prisma } = await import('../db.js');
  await prisma.$transaction(
    responses.map((r) =>
      prisma.userResponse.upsert({
        where: { userId_questionId: { userId, questionId: r.questionId } },
        create: { userId, questionId: r.questionId, value: r.value },
        update: { value: r.value },
      }),
    ),
  );

  const [discVector, progress] = await Promise.all([
    recalcDiscVector(userId),
    calcAdaptiveProgress(userId, req.tenant.tenantId),
  ]);

  return res.json({
    message: `${responses.length} yanıt kaydedildi.`,
    discVector,
    progress,
  });
}

// ─── GET /api/questions/my-responses ─────────────────────────────────────────

/**
 * Kullanıcının tamamlanma oranını ve adaptif faz durumunu döner.
 * Frontend bu endpoint'i kullanarak testi kaldığı yerden devam ettirebilir.
 */
export async function getMyResponses(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }

  const progress = await calcAdaptiveProgress(req.auth.userId, req.tenant.tenantId);
  return res.json(progress);
}
