import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { validateRequest } from '../middleware/validate.js';
import {
  getPendingSurveyQuestion,
  respondToSurvey,
  SurveyAlreadyAnsweredError,
  SurveyInvalidAnswerError,
  SurveyQuestionUnknownError,
  SurveyRoleNotEligibleError,
} from '../services/surveyService.js';
import { SURVEY_QUESTION_KEYS, SURVEY_TRIGGER_CONTEXTS } from '../services/surveyQuestions.js';

const PendingQuerySchema = z.object({
  context: z.enum(SURVEY_TRIGGER_CONTEXTS),
});

// GET /api/surveys/pending?context=<TRIGGER_CONTEXT>
// Bilinen bir tetikleyici bağlam için kullanıcının HENÜZ cevaplamadığı/kapatmadığı soruyu
// döner; yoksa `{ question: null }` (rol uygun değilse ya da zaten gösterilmişse de aynı).
export async function getPending(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const parsed = validateRequest(PendingQuerySchema, req.query, res);
  if (!parsed.success) return parsed.response;

  const question = await getPendingSurveyQuestion(req.auth.userId, req.auth.role, parsed.data.context);

  return res.json({ question });
}

const RespondParamsSchema = z.object({
  questionKey: z.enum(SURVEY_QUESTION_KEYS),
});

const RespondBodySchema = z.object({
  // Şık YOK/null = yalnız kapatıldı (X) — plan §3.2 "answerKey null = yalnız kapatıldı".
  answerKey: z.string().min(1).max(64).nullable().optional(),
});

// POST /api/surveys/:questionKey/respond
// Kimlik OTURUMDAN alınır (req.auth.userId) — istek gövdesinden DEĞİL; gövdede başka bir
// userId gönderilse dahi görmezden gelinir (Komşu Uç Karşılaştırması, CLAUDE.md § Güvenlik).
export async function respond(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const paramsParsed = validateRequest(RespondParamsSchema, req.params, res);
  if (!paramsParsed.success) return paramsParsed.response;

  const bodyParsed = validateRequest(RespondBodySchema, req.body ?? {}, res);
  if (!bodyParsed.success) return bodyParsed.response;

  try {
    const result = await respondToSurvey({
      userId: req.auth.userId,
      tenantId: req.tenant.tenantId,
      role: req.auth.role,
      questionKey: paramsParsed.data.questionKey,
      answerKey: bodyParsed.data.answerKey ?? null,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof SurveyRoleNotEligibleError) {
      return res.status(403).json({ error: 'YETKI_YETERSIZ' });
    }
    if (err instanceof SurveyInvalidAnswerError) {
      return res.status(400).json({ error: 'VALIDATION', message: 'Geçersiz şık.' });
    }
    if (err instanceof SurveyAlreadyAnsweredError) {
      return res.status(409).json({
        error: 'ZATEN_YANITLANDI',
        message: 'Bu soru daha önce cevaplandı ya da kapatıldı.',
      });
    }
    if (err instanceof SurveyQuestionUnknownError) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    throw err;
  }
}
