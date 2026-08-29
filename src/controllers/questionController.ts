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
import { notifyAdminsPendingUser } from '../services/notificationService.js';
import { sendAdminTestCompletedNotification } from '../services/emailService.js';

// ─── Validasyon şemaları ──────────────────────────────────────────────────────

const CreateQuestionSchema = z.object({
  text: z.string().min(10).max(500),
  type: z.enum(['CORE', 'DEEPENING']).default('CORE'),
  discDimension: z.enum(['D', 'I', 'S', 'C', 'GENERAL']).default('GENERAL'),
  // DISC_ASSESSMENT: karakter testi sorusu (DISC vektörüne katkı)
  // STK_CUSTOM: STK'nın kendi öğrenmek/izlemek istediği sorular (DISC'e katılmaz)
  category: z.enum(['DISC_ASSESSMENT', 'STK_CUSTOM']).default('STK_CUSTOM'),
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

// ─── Validasyon mesajı yardımcısı ─────────────────────────────────────────────

/**
 * Zod hatasından kullanıcıya gösterilebilir sade bir Türkçe mesaj türetir.
 *
 * Neden: `flatten()` yapısı FE'de generic "Hata" olarak görünüyordu (madde 69).
 * Bu yardımcı ilk sorunlu alanı Türkçe etiketiyle bildirir; iç şema yapısı,
 * stack veya alınan ham değer SIZDIRILMAZ (enumeration-safe, sade).
 */
const FIELD_LABELS: Record<string, string> = {
  text: 'Soru metni',
  type: 'Soru tipi',
  discDimension: 'DISC boyutu',
  category: 'Kategori',
  order: 'Sıra',
  tenantScoped: 'Kuruma özel',
  isRequired: 'Zorunluluk',
  isActive: 'Aktiflik',
  value: 'Cevap değeri',
  responses: 'Yanıtlar',
  questionId: 'Soru',
};

function firstValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Girdi doğrulanamadı. Lütfen alanları kontrol edin.';

  // path: iç içe şemada [alan, index, altAlan] olabilir — ilk metin segmentini al
  const fieldKey = issue.path.find((p): p is string => typeof p === 'string');
  const label = fieldKey ? (FIELD_LABELS[fieldKey] ?? fieldKey) : 'Girdi';
  return `${label}: ${issue.message}`;
}

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
    return res.status(400).json({
      error: 'VALIDATION',
      message: firstValidationMessage(parsed.error),
      details: parsed.error.flatten(),
    });
  }

  // DISC soru havuzu kilidi — sadece platform seviyesinde seed script ekleyebilir
  if (parsed.data.category === 'DISC_ASSESSMENT') {
    return res.status(403).json({
      error: 'DISC_KATEGORI_KILITLI',
      message: 'DISC_ASSESSMENT soruları sistem tarafından yönetilir. STK_CUSTOM kategorisinde soru ekleyebilirsiniz.',
    });
  }

  // Yetki (Y6/3b-2): Bu uç TENANT admininedir (requireTenant + requireRole('ADMIN')).
  // Global soru (tenantId:null) yaratımı YASAK — aksi halde bir kurumun admini `tenantScoped:false`
  // göndererek TÜM kurumların soru havuzuna görünen içerik enjekte edebilirdi (cross-tenant kirlilik).
  // Global sorular yalnız seed/platform seviyesindedir. Bu yüzden `tenantScoped` bayrağı YOK SAYILIR;
  // buradan yaratılan her soru DAİMA istek tenant'ına sınırlıdır.
  const { tenantScoped: _ignoredTenantScoped, ...data } = parsed.data;

  const { prisma } = await import('../db.js');
  const question = await prisma.question.create({
    data: { ...data, tenantId: req.tenant.tenantId },
  });
  // Yeni soru eklenince confidence hedefi değişir — cache'i invalidate et
  invalidateDimensionalCountCache();
  return res.status(201).json(question);
}

// ─── PATCH /api/questions/:id ────────────────────────────────────────────────

const UpdateQuestionSchema = z.object({
  text:       z.string().min(10).max(500).optional(),
  order:      z.number().int().min(0).optional(),
  isRequired: z.boolean().optional(),
  isActive:   z.boolean().optional(),
});

/** Admin: tenant'a ait soruyu günceller. Global (kilitli) sorulara dokunulamaz. */
export async function updateQuestion(req: RequestWithTenant, res: Response) {
  const { prisma } = await import('../db.js');
  const questionId = req.params['questionId'] as string;

  const question = await prisma.question.findUnique({
    where:  { id: questionId },
    select: { id: true, tenantId: true },
  });
  if (!question) return res.status(404).json({ error: 'NOT_FOUND' });

  // Global çekirdek soru kilidi — sadece tenant'a özgü sorular değiştirilebilir
  if (question.tenantId === null) {
    return res.status(403).json({
      error: 'GLOBAL_SORU_KILITLI',
      message: 'Global çekirdek sorular değiştirilemez. Yeni tenant sorusu oluşturun.',
    });
  }
  if (question.tenantId !== req.tenant.tenantId) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const parsed = UpdateQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'VALIDATION',
      message: firstValidationMessage(parsed.error),
      details: parsed.error.flatten(),
    });
  }

  const updated = await prisma.question.update({
    where: { id: questionId },
    data:  parsed.data,
  });
  invalidateDimensionalCountCache();
  return res.json(updated);
}

// ─── DELETE /api/questions/:id ───────────────────────────────────────────────

/** Admin: tenant'a ait soruyu siler. Global sorular silinemez. */
export async function deleteQuestion(req: RequestWithTenant, res: Response) {
  const { prisma } = await import('../db.js');
  const questionId = req.params['questionId'] as string;

  const question = await prisma.question.findUnique({
    where:  { id: questionId },
    select: { id: true, tenantId: true },
  });
  if (!question) return res.status(404).json({ error: 'NOT_FOUND' });

  if (question.tenantId === null) {
    return res.status(403).json({
      error: 'GLOBAL_SORU_KILITLI',
      message: 'Global çekirdek sorular silinemez. Gizlemek için /hide endpoint\'ini kullanın.',
    });
  }
  if (question.tenantId !== req.tenant.tenantId) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  await prisma.question.delete({ where: { id: questionId } });
  invalidateDimensionalCountCache();
  return res.status(204).send();
}

// ─── POST /api/questions/:id/hide ────────────────────────────────────────────

/** Admin: global bir soruyu kendi kurumundan gizler (silmez — veri bütünlüğü korunur). */
export async function hideGlobalQuestion(req: RequestWithTenant, res: Response) {
  const { prisma } = await import('../db.js');
  const questionId = req.params['questionId'] as string;

  const question = await prisma.question.findUnique({
    where:  { id: questionId },
    select: { id: true, tenantId: true, category: true },
  });
  if (!question) return res.status(404).json({ error: 'NOT_FOUND' });

  if (question.tenantId !== null) {
    return res.status(400).json({
      error: 'SADECE_GLOBAL_SORULAR',
      message: 'Bu endpoint yalnızca global soruları gizler. Tenant sorularını silebilirsiniz.',
    });
  }

  // DISC soru havuzu kilidi — gizleme eşleştirme vektörünü bozar
  if (question.category === 'DISC_ASSESSMENT') {
    return res.status(403).json({
      error: 'DISC_SORULARI_KILITLI',
      message: 'DISC değerlendirme soruları gizlenemez. Bu sorular eşleştirme algoritması için zorunludur.',
    });
  }

  const hide = await prisma.questionHide.upsert({
    where:  { questionId_tenantId: { questionId, tenantId: req.tenant.tenantId } },
    create: { questionId, tenantId: req.tenant.tenantId },
    update: {},
  });

  return res.status(201).json(hide);
}

// ─── DELETE /api/questions/:id/hide ──────────────────────────────────────────

/** Admin: gizlenen global soruyu yeniden gösterir. */
export async function unhideGlobalQuestion(req: RequestWithTenant, res: Response) {
  const { prisma } = await import('../db.js');
  const questionId = req.params['questionId'] as string;

  await prisma.questionHide.deleteMany({
    where: { questionId, tenantId: req.tenant.tenantId },
  });

  return res.status(204).send();
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
    return res.status(400).json({
      error: 'VALIDATION',
      message: firstValidationMessage(parsed.error),
      details: parsed.error.flatten(),
    });
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

  // CORE test ilk kez tamamlandığında bekleme odası bildirimi gönder
  if (progress.coreAnswered >= progress.coreThreshold) {
    void triggerWaitingRoomNotificationIfNeeded(userId, req.tenant.tenantId);
  }

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
    return res.status(400).json({
      error: 'VALIDATION',
      message: firstValidationMessage(parsed.error),
      details: parsed.error.flatten(),
    });
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

// ─── Bekleme Odası Bildirim Tetikleyici ──────────────────────────────────────

/**
 * CORE testi ilk kez tamamlandığında (discAssessmentCompletedAt null → now) admin'lere
 * e-posta + push bildirim gönderir. İdempotent: ikinci çağrıda hiçbir şey yapmaz.
 */
async function triggerWaitingRoomNotificationIfNeeded(
  userId: string,
  tenantId: string,
): Promise<void> {
  const { prisma } = await import('../db.js');

  // Zaten bildirim gönderilmişse çık (idempotency)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      discAssessmentCompletedAt: true,
      approvalStatus: true,
      fullName: true,
      role: true,
    } as Parameters<typeof prisma.user.findUnique>[0]['select'],
  });
  if (!user || (user as { discAssessmentCompletedAt: Date | null }).discAssessmentCompletedAt !== null || user.approvalStatus !== 'PENDING') return;

  // Tamamlanma zamanını kaydet (bir daha tetiklenmemesi için)
  await prisma.user.update({
    where: { id: userId },
    data: { discAssessmentCompletedAt: new Date() } as Parameters<typeof prisma.user.update>[0]['data'],
  });

  // Tenant admin'lerini bul
  const admins = await prisma.user.findMany({
    where: { tenantId, role: 'ADMIN', isActive: true },
    select: { id: true, fullName: true, email: true },
  });

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { displayName: true, name: true },
  });
  const tenantName = tenant?.displayName ?? tenant?.name ?? tenantId;

  for (const admin of admins) {
    void notifyAdminsPendingUser({
      tenantId,
      newUserFullName: user.fullName,
      newUserRole: user.role,
    });
    void sendAdminTestCompletedNotification({
      toEmail: admin.email,
      adminName: admin.fullName,
      userName: user.fullName,
      userRole: user.role,
      tenantName,
    }).catch((err) =>
      void logger.error('EMAIL', 'Test tamamlama e-postası gönderilemedi', {
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
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
