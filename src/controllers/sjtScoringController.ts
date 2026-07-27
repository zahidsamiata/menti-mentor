import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { computeAndStoreProfile, rankMentorsForMenti, type CertData } from '../services/scoring.service.js';
import { computeSectorScore } from '../services/scoring.js';
import { submitFeedback } from '../services/feedback.service.js';
import { scoreSjtAnswers, type SjtAnswer } from '../services/sjt-scorer.js';
import {
  evaluateCertification,
  getCertificationQuestions,
  revealOption,
  setCertificationTopic,
  getTopicsOverview,
  CertTopicError,
} from '../services/certification.service.js';

const SjtAnswerSchema = z.object({
  questionCode: z.string().min(1),
  optionKey:    z.string().optional(),
  mostKey:      z.string().optional(),
  leastKey:     z.string().optional(),
});

const ComputeProfileSchema = z.object({
  userId:  z.string().min(1),
  role:    z.enum(['ADMIN', 'MENTOR', 'MENTI']),
  answers: z.array(SjtAnswerSchema).optional(),
});

const RankMentorsSchema = z.object({
  mentiId: z.string().min(1),
  limit:   z.coerce.number().int().min(1).max(100).optional(),
});

const FeedbackSchema = z.object({
  matchId:       z.string().min(1),
  checkpoint:    z.enum(['DAY_3', 'DAY_14', 'DAY_30']),
  fromUserId:    z.string().min(1),
  role:          z.enum(['ADMIN', 'MENTOR', 'MENTI']),
  progressScore: z.number().int().min(1).max(5).optional(),
  rapportScore:  z.number().int().min(1).max(5).optional(),
  earlyExit:     z.boolean().optional(),
  comment:       z.string().max(1000).optional(),
});

// POST /api/scoring/compute-profile
export async function computeProfileHandler(req: RequestWithTenant, res: Response) {
  const parsed = ComputeProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { userId, role, answers } = parsed.data;
  const sjtOverrides =
    Array.isArray(answers) && answers.length > 0
      ? await scoreSjtAnswers(answers as SjtAnswer[])
      : undefined;

  const profile = await computeAndStoreProfile(userId, role, req.tenant.tenantId, sjtOverrides);

  return res.json({
    userId: profile.userId,
    archetype: profile.archetype,
    role: profile.archetypeRole,
    profileSource: profile.profileSource,
    ocean: {
      o: profile.oceanO,
      c: profile.oceanC,
      e: profile.oceanE,
      a: profile.oceanA,
      n: profile.oceanN,
    },
  });
}

// POST /api/scoring/rank-mentors
export async function rankMentorsHandler(req: RequestWithTenant, res: Response) {
  const parsed = RankMentorsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { mentiId, limit } = parsed.data;

  // UserProfile'da doğrudan tenantId yok; user ilişkisi üzerinden izolasyon sağlanır.
  const menti = await prisma.userProfile.findFirst({
    where: { id: mentiId, user: { tenantId: req.tenant.tenantId } },
  });
  if (!menti?.archetype) {
    return res.status(404).json({
      error: 'ARKETIP_HESAPLANMAMIS',
      message: 'Menti arketipi henüz hesaplanmamış. Önce /compute-profile çağrısı yapın.',
    });
  }

  const mentors = await prisma.userProfile.findMany({
    where: {
      archetypeRole: 'MENTOR',
      archetype:     { not: null },
      id:            { not: mentiId },
      user:          { tenantId: req.tenant.tenantId },
    },
  });

  // Sertifikasyon verisi TenantMembership'ten okunur (per-tenant, UserProfile'dan değil).
  const membershipRows = await prisma.tenantMembership.findMany({
    where: {
      tenantId: req.tenant.tenantId,
      userId:   { in: mentors.map((m) => m.userId) },
    },
    select: { userId: true, isCertified: true, qualityMultiplier: true },
  });
  const certDataMap = new Map<string, CertData>(
    membershipRows.map((r) => [r.userId, {
      isCertified:       r.isCertified,
      qualityMultiplier: r.qualityMultiplier,
    }]),
  );

  const ranked = rankMentorsForMenti(
    menti,
    mentors,
    (mentor) => computeSectorScore(menti.goalTags, mentor.skillTags),
    certDataMap,
  );
  const results = limit ? ranked.slice(0, limit) : ranked;

  return res.json({ mentiId, totalEligible: ranked.length, results });
}

// Not: userId body'den ALINMAZ — IDOR önlemek için kimliği doğrulanmış kullanıcı
// (req.auth) kendi sertifikasını değerlendirir. answers = konu-bazında ilk seçimler.
const CertifySchema = z.object({
  answers: z.array(z.object({
    questionCode: z.string().min(1),
    optionKey:    z.string().min(1),
  })).min(1),
});

const RevealAnswerSchema = z.object({
  questionCode: z.string().min(1),
  optionKey:    z.string().min(1),
});

// GET /api/scoring/certification/questions — öğrenme akışı senaryoları (cevap sızdırmaz)
// Önceki denemede geçilemeyen konular (certWrongTopics) varsa listenin başına alınır.
export async function certQuestionsHandler(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const membership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId: req.auth.userId, tenantId: req.tenant.tenantId } },
    select: { certWrongTopics: true },
  });
  const questions = await getCertificationQuestions(
    req.tenant.tenantId,
    membership?.certWrongTopics ?? [],
  );
  return res.status(200).json({ questions });
}

const SetTopicSchema = z.object({
  topic:   z.string().min(1).max(100),
  enabled: z.boolean(),
});

// GET /api/scoring/certification/topics — kurumun konu aç/kapat + eşik özeti (ADMIN)
export async function certTopicsListHandler(req: RequestWithTenant, res: Response) {
  const overview = await getTopicsOverview(req.tenant.tenantId);
  return res.status(200).json(overview);
}

// PATCH /api/scoring/certification/topics — konu aç/kapat (ADMIN, yalnızca kendi tenant'ı)
export async function certTopicSetHandler(req: RequestWithTenant, res: Response) {
  const parsed = SetTopicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  try {
    await setCertificationTopic(req.tenant.tenantId, parsed.data.topic, parsed.data.enabled);
    const overview = await getTopicsOverview(req.tenant.tenantId);
    return res.status(200).json(overview);
  } catch (err) {
    if (err instanceof CertTopicError) {
      // UNKNOWN_TOPIC/TENANT_NOT_FOUND → 404; RED_LINE_LOCKED/MIN_TOPICS → 409 (kural ihlali)
      const status = err.code === 'UNKNOWN_TOPIC' || err.code === 'TENANT_NOT_FOUND' ? 404 : 409;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    throw err;
  }
}

// POST /api/scoring/certification/answer — seçim sonrası açıklama (öğrenme anı)
export async function certRevealHandler(req: RequestWithTenant, res: Response) {
  const parsed = RevealAnswerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  try {
    const reveal = await revealOption(parsed.data.questionCode, parsed.data.optionKey);
    return res.status(200).json(reveal);
  } catch {
    return res.status(404).json({ error: 'BULUNAMADI', message: 'Soru veya seçenek bulunamadı.' });
  }
}

// POST /api/scoring/certify
export async function certifyHandler(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const parsed = CertifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  // IDOR koruması: yalnızca kimliği doğrulanmış kullanıcının kendi sertifikası.
  const result = await evaluateCertification(req.auth.userId, req.tenant.tenantId, parsed.data.answers);
  if (result.failReason === 'NO_ACTIVE_TOPICS') {
    return res.status(409).json({
      error: 'NO_ACTIVE_TOPICS',
      message: 'Bu kurumda açık sertifika konusu yok; değerlendirme yapılamaz.',
    });
  }
  if (result.failReason === 'COOLDOWN_ACTIVE') {
    return res.status(409).json({
      error: 'COOLDOWN_ACTIVE',
      message: 'Bekleme süresi henüz dolmadı; yeni deneme için lütfen bekleyin.',
      cooldownUntil: result.cooldownUntil,
    });
  }
  return res.status(200).json(result);
}

// POST /api/scoring/feedback
export async function feedbackHandler(req: RequestWithTenant, res: Response) {
  const parsed = FeedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const feedback = await submitFeedback({ ...parsed.data, tenantId: req.tenant.tenantId });
  return res.status(201).json({ id: feedback.id, recorded: true });
}
