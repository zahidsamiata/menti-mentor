import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { computeAndStoreProfile, rankMentorsForMenti, type CertData } from '../services/scoring.service.js';
import { computeSectorScore } from '../services/scoring.js';
import { submitFeedback, FeedbackAuthError } from '../services/feedback.service.js';
import { scoreSjtAnswers, type SjtAnswer } from '../services/sjt-scorer.js';
import {
  evaluateCertification,
  getCertificationQuestions,
  revealOption,
  setCertificationTopic,
  getTopicsOverview,
  CertTopicError,
} from '../services/certification.service.js';
import { validateRequest } from '../middleware/validate.js';

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

// GÜVENLİK: fromUserId ve role bilerek YOK — kimlik yalnız oturumdan (req.auth) alınır.
// z.object varsayılanı strip'tir (.strict() değil): eski istemciler bu alanları göndermeye
// devam etse bile istek REDDEDİLMEZ, alanlar sessizce yok sayılır.
const FeedbackSchema = z.object({
  matchId:       z.string().min(1),
  checkpoint:    z.enum(['DAY_3', 'DAY_14', 'DAY_30']),
  progressScore: z.number().int().min(1).max(5).optional(),
  rapportScore:  z.number().int().min(1).max(5).optional(),
  earlyExit:     z.boolean().optional(),
  comment:       z.string().max(1000).optional(),
});

// POST /api/scoring/compute-profile
export async function computeProfileHandler(req: RequestWithTenant, res: Response) {
  const parsed = validateRequest(ComputeProfileSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const { userId, role, answers } = parsed.data;

  // Yetki (Y5/3b-2): userId + role GÖVDEDEN geliyor. Guard olmadan bir üye, başkasının
  // OCEAN/archetype/archetypeRole'ünü (rol flip dahil) ezebilirdi. Kural: yalnız KENDİ
  // profilini hesaplar; ADMIN herhangi birini. Non-admin için role de token'dan zorlanır
  // (gövdeyle rol yükseltme/flip engeli). computeAndStoreProfile zaten user:{tenantId} ile
  // tenant'a sınırlı → cross-tenant değil; buradaki eksik tenant-İÇİ sahiplikti.
  const isAdmin = req.auth?.role === 'ADMIN';
  if (!isAdmin && userId !== req.auth?.userId) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca kendi profilinizi hesaplayabilirsiniz.' });
  }
  const effectiveRole = isAdmin ? role : (req.auth!.role);

  const sjtOverrides =
    Array.isArray(answers) && answers.length > 0
      ? await scoreSjtAnswers(answers as SjtAnswer[])
      : undefined;

  const profile = await computeAndStoreProfile(userId, effectiveRole, req.tenant.tenantId, sjtOverrides);

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
  const parsed = validateRequest(RankMentorsSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  const { mentiId, limit } = parsed.data;

  // UserProfile'da doğrudan tenantId yok; user ilişkisi üzerinden izolasyon sağlanır.
  const menti = await prisma.userProfile.findFirst({
    where: { id: mentiId, user: { tenantId: req.tenant.tenantId } },
  });

  // GV-25: komşu uç computeProfileHandler ile aynı sahiplik kuralı. mentiId GÖVDEDEN geliyor;
  // kontrol olmadan bir üye başkasının kişiselleştirilmiş mentör sıralamasını isteyebilirdi.
  // Kural: yalnız KENDİ profili (UserProfile.userId === oturumdaki kullanıcı); ADMIN kurum içinde
  // herhangi biri. Kurum izolasyonu yukarıdaki user:{tenantId} filtresiyle korunur (başka kurum → 404).
  const isAdmin = req.auth?.role === 'ADMIN';
  if (menti && !isAdmin && menti.userId !== req.auth?.userId) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca kendi mentör sıralamanızı görebilirsiniz.' });
  }

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
// Önceki denemede geçilemeyen konular (certWrongTopics) listenin başına alınır ve
// tekrar denemede her konunun diğer varyantı (farklı sahne) önce gelir (certAttempts).
// retryTopics: ekranın "geçen sefer zorlandığın konu" işareti için — kişinin KENDİ verisi.
export async function certQuestionsHandler(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const membership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId: req.auth.userId, tenantId: req.tenant.tenantId } },
    select: { certWrongTopics: true, certAttempts: true },
  });
  const retryTopics = membership?.certWrongTopics ?? [];
  const questions = await getCertificationQuestions(
    req.tenant.tenantId,
    retryTopics,
    membership?.certAttempts ?? 0,
  );
  return res.status(200).json({ questions, retryTopics });
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
  const parsed = validateRequest(SetTopicSchema, req.body, res);
  if (!parsed.success) return parsed.response;
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
  const parsed = validateRequest(RevealAnswerSchema, req.body, res);
  if (!parsed.success) return parsed.response;
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
  const parsed = validateRequest(CertifySchema, req.body, res);
  if (!parsed.success) return parsed.response;

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
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const parsed = validateRequest(FeedbackSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  // Kurum-içi rol kaynağı TenantMembership.role'dür, User.role DEĞİL (veri modeli kuralı):
  // aynı kişi farklı kurumlarda farklı rolde olabilir. certQuestionsHandler ile aynı desen.
  const membership = await prisma.tenantMembership.findUnique({
    where:  { userId_tenantId: { userId: req.auth.userId, tenantId: req.tenant.tenantId } },
    select: { role: true },
  });
  if (!membership) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Bu kurumda üyeliğiniz bulunmuyor.' });
  }

  try {
    const feedback = await submitFeedback({
      ...parsed.data,
      tenantId:   req.tenant.tenantId,
      fromUserId: req.auth.userId,   // kimlik YALNIZ oturumdan
      role:       membership.role,   // rol YALNIZ kurum üyeliğinden
    });
    return res.status(201).json({ id: feedback.id, recorded: true });
  } catch (err) {
    if (err instanceof FeedbackAuthError) {
      const status = err.code === 'MATCH_NOT_FOUND' ? 404 : 403;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    throw err;
  }
}
