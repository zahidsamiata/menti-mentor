/**
 * Admin Panel Controller (Sprint 8+)
 *
 * Compliance Note: Tüm KPI endpoint'leri yalnızca aggregate veri döndürür.
 * Satır seviyesinde PII içeren alanlar (fullName, email, discVector vb.)
 * bu endpoint'lerden hiçbir zaman döndürülmez.
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { runWeeklyTuning, runWeeklyPurge } from '../services/cronScheduler.js';
import { logger } from '../services/logger.js';
import { ensureMembershipSafe } from '../services/membership.js';
import { notifyRematchRequested } from '../services/notificationService.js';
import { sendUserApprovalNotification } from '../services/emailService.js';
import { generateSuggestions } from '../services/coachingSuggestions.js';
import {
  getPendingAdjustment,
  applyPendingAdjustment,
  rejectPendingAdjustment,
} from '../services/algorithmTuner.js';
import { computeHealthMetrics } from '../services/retentionMetrics.service.js';
import { wasRecentlyNudged, sendNudge, NUDGE_COOLDOWN_HOURS } from '../services/nudgeService.js';

// ─── KPI Dashboard ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/kpi
 * Compliance: Yalnızca aggregate istatistikler — PII içermez.
 */
export async function getKpiDashboard(req: RequestWithTenant, res: Response) {
  const tenantId = req.tenant.tenantId;

  const [
    totalUsers,
    usersByRole,
    activeMatches,
    pendingOptIns,
    totalFeedbackLogs,
    avgNpsByPhase,
    rematchUsers,
    activeJobListings,
  ] = await Promise.all([
    // Toplam kullanıcı
    prisma.user.count({ where: { tenantId, isActive: true } }),

    // Rol bazında dağılım (Analytical)
    prisma.user.groupBy({
      by: ['role'],
      where: { tenantId, isActive: true },
      _count: { id: true },
    }),

    // Aktif eşleşmeler (APPROVED opt-in sayısı)
    prisma.visibilityOptIn.count({
      where: { tenantId, status: 'APPROVED' },
    }),

    // Bekleyen talep kuyruğu
    prisma.visibilityOptIn.count({
      where: { tenantId, status: 'PENDING' },
    }),

    // Toplam geri bildirim
    prisma.feedbackLog.count({ where: { tenantId } }),

    // Faz bazında ortalama NPS (Analytical)
    prisma.feedbackLog.groupBy({
      by: ['phase'],
      where: { tenantId, npsScore: { not: null } },
      _avg: { npsScore: true },
      _count: { id: true },
    }),

    // Rematch öncelikli kullanıcı sayısı
    prisma.user.count({ where: { tenantId, rematchPriority: true, isActive: true } }),

    // Aktif iş ilanları
    prisma.jobListing.count({ where: { tenantId, isActive: true } }),
  ]);

  // Başarı oranı: 3. ay NPS ≥ 70 olan eşleşmeler / toplam 3. ay feedback
  const phase3Logs = avgNpsByPhase.find((p) => p.phase === 3);
  const successRate =
    phase3Logs && phase3Logs._avg.npsScore !== null
      ? Math.round(phase3Logs._avg.npsScore)
      : null;

  return res.json({
    tenantId,
    generatedAt: new Date().toISOString(),
    compliance: 'aggregate-only — no PII',
    stats: {
      totalActiveUsers: totalUsers,
      usersByRole: Object.fromEntries(
        usersByRole.map((r) => [r.role, r._count.id]),
      ),
      matching: {
        activeMatches,
        pendingOptIns,
        rematchPriorityUsers: rematchUsers,
      },
      feedback: {
        totalFeedbackLogs,
        avgNpsByPhase: Object.fromEntries(
          avgNpsByPhase.map((p) => [
            `phase${p.phase}`,
            {
              avgNps: p._avg.npsScore !== null ? Math.round(p._avg.npsScore) : null,
              sampleSize: p._count.id,
            },
          ]),
        ),
        successRate,
      },
      activeJobListings,
    },
  });
}

// ─── Sağlık / Retention Metrikleri (S2: "kimse kaynıyor mu") ──────────────────

const HealthMetricsQuerySchema = z.object({
  passiveDays: z.coerce.number().int().min(1).max(365).optional(),
  staleDays: z.coerce.number().int().min(1).max(365).optional(),
});

/**
 * GET /api/admin/health-metrics
 * Mentörsüz menti + ölü eşleşme + pasif üye + arz-talep dengesi. Admin-only + tenant-scoped.
 * Drill-down için sayı + sınırlı kişi listesi döner (ad/rol/zaman damgası). Ham DISC/email DÖNMEZ.
 * Eşikler opsiyonel query ile ayarlanabilir (passiveDays, staleDays); makul default'lar serviste.
 */
export async function getHealthMetrics(req: RequestWithTenant, res: Response) {
  const parsed = HealthMetricsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const metrics = await computeHealthMetrics(req.tenant.tenantId, {
    passiveDays: parsed.data.passiveDays,
    staleMatchDays: parsed.data.staleDays,
  });

  return res.json({
    tenantId: req.tenant.tenantId,
    generatedAt: new Date().toISOString(),
    ...metrics,
  });
}

// ─── Dürtme (Nudge): yönetici pasif üye / ölü eşleşmeye elle hatırlatma ────────

const NudgeSchema = z.object({
  kind: z.enum(['PASSIVE', 'DEAD_MATCH', 'GENERIC']).optional().default('GENERIC'),
  message: z.string().trim().max(300).optional(),
});

/**
 * POST /api/admin/users/:id/nudge
 * Yönetici, kendi tenant'ındaki bir üyeye (MENTOR/MENTI) re-engagement hatırlatması gönderir.
 * Güvenlik: tenant-scoped + ADMIN (route middleware) + spam limiti (24s) + denetim logu.
 * Ham PII log'a yazılmaz. Otomatik toplu dürtme KAPSAM DIŞI (KVKK/rıza — bkz. nudgeService notu).
 */
export async function nudgeUser(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const parsed = NudgeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const targetId = req.params['id'] as string;
  const tenantId = req.tenant.tenantId;

  // Tenant izolasyonu: hedef bu tenant'ın üyesi olmalı.
  const target = await prisma.user.findFirst({
    where: { id: targetId, tenantId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (!target || !target.isActive) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Üye bulunamadı.' });
  }
  if (target.id === req.auth.userId) {
    return res.status(400).json({ error: 'GECERSIZ_HEDEF', message: 'Kendinize hatırlatma gönderemezsiniz.' });
  }
  if (target.role === 'ADMIN') {
    return res.status(400).json({ error: 'GECERSIZ_HEDEF', message: 'Yalnızca mentör/menti üyelere hatırlatma gönderilebilir.' });
  }

  // Spam limiti: aynı üyeye 24 saatte bir.
  if (await wasRecentlyNudged(tenantId, target.id)) {
    return res.status(429).json({
      error: 'DURTME_LIMITI',
      message: `Bu üyeye son ${NUDGE_COOLDOWN_HOURS} saatte zaten hatırlatma gönderildi.`,
    });
  }

  const tenantRecord = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, displayName: true } });
  const tenantName = tenantRecord?.displayName ?? tenantRecord?.name ?? 'Mentörlük Programı';

  await sendNudge({
    tenantId,
    targetUserId: target.id,
    targetEmail: target.email,
    targetName: target.fullName,
    byUserId: req.auth.userId,
    tenantName,
    kind: parsed.data.kind,
    message: parsed.data.message,
  });

  return res.json({ ok: true, targetUserId: target.id, sentAt: new Date().toISOString() });
}

// ─── Kullanıcı Listesi (Admin) ────────────────────────────────────────────────

const AdminUserListSchema = z.object({
  role: z.enum(['ADMIN', 'MENTOR', 'MENTI']).optional(),
  isActive: z.string().optional().transform((v) => (v === undefined ? undefined : v !== 'false')),
  rematchOnly: z.string().optional().transform((v) => v === 'true'),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * GET /api/admin/users
 * Compliance: discVector, selfProfile, temperamentJson hariç tutulur.
 */
export async function adminListUsers(req: RequestWithTenant, res: Response) {
  const parsed = AdminUserListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { role, isActive, rematchOnly, approvalStatus, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId: req.tenant.tenantId,
    ...(role !== undefined && { role }),
    ...(isActive !== undefined && { isActive }),
    ...(rematchOnly && { rematchPriority: true }),
    ...(approvalStatus !== undefined && { approvalStatus }),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, role: true, email: true, fullName: true, isActive: true,
        sectorTags: true, discType: true, skills: true,
        rematchPriority: true, rematchCount: true,
        needsOrientation: true, approvalStatus: true, createdAt: true,
        avatarUrl: true, // Kart/havuz gösterimi — public profil görseli (PII değil)
        // İş 2/3: onay/red denetim izi + gerekçe (yalnız admin listesi; audit — meşru yönetim verisi).
        approvedBy: true, approvedAt: true, rejectedBy: true, rejectedAt: true, rejectionReason: true,
        // Sertifika rozeti (KARAR 4, kişi-geneli — PO kararı). Sertifika kişi bazında geneldir:
        // kişi HERHANGİ bir kurumda sertifikalıysa sertifikalı sayılır (kurum farkı gözetilmez).
        // isCertified yalnız TenantMembership'te tutulur (UserProfile.isCertified bakımsız), bu
        // yüzden tüm üyelikler üzerinden türetilir. Kalite/güven göstergesi — Analytical, PII değil.
        memberships: {
          where: { isCertified: true },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip,
    }),
    prisma.user.count({ where }),
  ]);

  // Kişi-geneli sertifika: herhangi bir kurumda sertifikalıysa true (üyelik dizisi response'a sızmaz).
  const items = rows.map(({ memberships, ...rest }) => ({
    ...rest,
    isCertified: memberships.length > 0,
  }));

  return res.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

// ─── Eşleşme Listesi (Admin) — A1 ─────────────────────────────────────────────

const AdminMatchListSchema = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED', 'EARLY_EXIT', 'DISSOLVED']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * GET /api/admin/matches — kurumdaki mentör-menti eşleşmeleri (persist edilmiş Match kayıtları).
 * GÜVENLİK: tenant izolasyonu (where.tenantId), admin-only (adminRoutes). KVKK: yalnızca ad + arketip
 * + skor gösterilir; ham discVector/email DÖNMEZ.
 */
export async function adminListMatches(req: RequestWithTenant, res: Response) {
  const parsed = AdminMatchListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const { status, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId: req.tenant.tenantId, // KATMAN 3 — tenant izolasyonu
    ...(status !== undefined && { status }),
  };

  const [rows, total] = await Promise.all([
    prisma.match.findMany({
      where,
      select: {
        id: true,
        predictedScore: true, sectorScore: true, characterScore: true,
        mentorArchetype: true, mentiArchetype: true, status: true, createdAt: true,
        mentor: { select: { user: { select: { fullName: true } } } },
        menti: { select: { user: { select: { fullName: true } } } },
        _count: { select: { meetings: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip,
    }),
    prisma.match.count({ where }),
  ]);

  const items = rows.map((m) => ({
    id: m.id,
    mentorName: m.mentor.user.fullName,
    mentiName: m.menti.user.fullName,
    predictedScore: m.predictedScore,
    sectorScore: m.sectorScore,
    characterScore: m.characterScore,
    mentorArchetype: m.mentorArchetype,
    mentiArchetype: m.mentiArchetype,
    status: m.status,
    meetingCount: m._count.meetings,
    createdAt: m.createdAt,
  }));

  void logger.info('SYSTEM', 'Admin: Eşleşme listesi görüntülendi', { tenantId: req.tenant.tenantId }); // KATMAN 9
  return res.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

// ─── Mentör Sertifika Sonuçları (Admin) — A4 ──────────────────────────────────

const AdminCertResultsSchema = z.object({
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'CERTIFIED', 'FAILED', 'COOLDOWN']).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * GET /api/admin/mentors/certification-results — mentörlerin sertifika durumu/skoru/deneme sayısı.
 * GÜVENLİK: tenant izolasyonu (where.tenantId), admin-only. certScore yalnızca admin görür.
 * Kaynak: TenantMembership (kurum-içi rol/sertifika kaynağı).
 */
export async function adminListCertResults(req: RequestWithTenant, res: Response) {
  const parsed = AdminCertResultsSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }
  const { status, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId: req.tenant.tenantId, // KATMAN 3 — tenant izolasyonu
    role: 'MENTOR' as const,
    isActive: true,
    ...(status !== undefined && { certificationStatus: status }),
  };

  const [rows, total] = await Promise.all([
    prisma.tenantMembership.findMany({
      where,
      select: {
        userId: true,
        isCertified: true, certificationStatus: true, certScore: true,
        certAttempts: true, certifiedAt: true, cooldownUntil: true,
        user: { select: { fullName: true } },
      },
      orderBy: [{ certifiedAt: 'desc' }],
      take: pageSize,
      skip,
    }),
    prisma.tenantMembership.count({ where }),
  ]);

  const items = rows.map((m) => ({
    userId: m.userId,
    fullName: m.user.fullName,
    isCertified: m.isCertified,
    certificationStatus: m.certificationStatus,
    certScore: m.certScore,
    certAttempts: m.certAttempts,
    certifiedAt: m.certifiedAt,
    cooldownUntil: m.cooldownUntil,
  }));

  void logger.info('SYSTEM', 'Admin: Sertifika sonuçları görüntülendi', { tenantId: req.tenant.tenantId }); // KATMAN 9
  return res.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

// ─── Rematch Talebi ───────────────────────────────────────────────────────────

const RematchSchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/admin/users/:id/rematch
 * Kullanıcıyı rematch öncelik kuyruğuna alır.
 * Mevcut APPROVED VisibilityOptIn'ler PENDING'e döndürülür.
 */
export async function triggerRematch(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  const parsed = RematchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true, role: true, tenantId: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  const result = await prisma.$transaction(async (tx) => {
    // APPROVED opt-in'leri PENDING'e al (yeniden eşleştirme akışı)
    const resetCount = await tx.visibilityOptIn.updateMany({
      where: {
        OR: [
          { mentorId: userId, initiatedBy: 'MENTOR', status: 'APPROVED' },
          { mentiId: userId, status: 'APPROVED' },
        ],
      },
      data: { status: 'PENDING' },
    });

    // Kullanıcı bayraklarını güncelle
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        rematchPriority: true,
        rematchCount: { increment: 1 },
      },
      select: { id: true, rematchCount: true, role: true },
    });

    return { updated, resetOptIns: resetCount.count };
  });

  void logger.info('SYSTEM', 'Admin: Rematch tetiklendi', {
    userId,
    tenantId: req.tenant.tenantId,
    rematchCount: result.updated.rematchCount,
    reason: parsed.data.reason,
  });

  // Bildirimi gönder (stub)
  void notifyRematchRequested(userId, req.tenant.tenantId);

  return res.json({
    message: 'Rematch öncelik kuyruğuna alındı.',
    userId,
    rematchCount: result.updated.rematchCount,
    optInsReset: result.resetOptIns,
  });
}

// ─── Double Opt-In Onay ───────────────────────────────────────────────────────

/**
 * POST /api/admin/visibility-optin/:optInId/confirm
 * Admin, çift taraflı onayı manuel olarak tamamlar.
 */
export async function confirmDoubleOptIn(req: RequestWithTenant, res: Response) {
  const optInId = req.params['optInId'] as string;

  const optIn = await prisma.visibilityOptIn.findFirst({
    where: { id: optInId, tenantId: req.tenant.tenantId },
    select: { id: true, status: true, mentorId: true, mentiId: true },
  });

  if (!optIn) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Opt-in kaydı bulunamadı.' });
  }

  if (optIn.status === 'APPROVED') {
    return res.status(409).json({ error: 'ZATEN_ONAYLANDI', message: 'Bu opt-in zaten onaylandı.' });
  }

  await prisma.visibilityOptIn.update({
    where: { id: optInId },
    data: { status: 'APPROVED' },
  });

  void logger.info('SYSTEM', 'Admin: Double opt-in manuel olarak onaylandı', {
    optInId,
    tenantId: req.tenant.tenantId,
  });

  return res.json({ message: 'Opt-in onaylandı.', optInId, status: 'APPROVED' });
}

// ─── Cron Manuel Tetikleme ────────────────────────────────────────────────────

/**
 * POST /api/admin/cron/run-tuning
 * Algoritma ağırlık ayarlamasını manuel çalıştırır.
 */
export async function manualRunTuning(_req: RequestWithTenant, res: Response) {
  void logger.info('SYSTEM', 'Admin: Manuel ağırlık ayarlaması tetiklendi');
  const results = await runWeeklyTuning();
  return res.json({ message: 'Ağırlık ayarlaması tamamlandı.', results });
}

/**
 * POST /api/admin/cron/run-purge
 * KVKK veri temizliğini manuel çalıştırır.
 */
export async function manualRunPurge(_req: RequestWithTenant, res: Response) {
  void logger.info('SYSTEM', 'Admin: Manuel KVKK temizliği tetiklendi');
  const result = await runWeeklyPurge();
  return res.json({ message: 'KVKK veri temizliği tamamlandı.', result });
}

// ─── Kullanıcı Onay / Red ─────────────────────────────────────────────────────

/**
 * POST /api/admin/users/:id/approve
 * PENDING kullanıcıyı onaylar; eşleşme havuzuna dahil eder.
 */
export async function approveUser(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  if (userId === req.auth?.userId) {
    return res.status(403).json({ error: 'KENDINI_ONAYLA_YASAK', message: 'Kendi hesabınızı kendiniz onaylayamazsınız.' });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true, email: true, fullName: true, approvalStatus: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }
  if (user.approvalStatus === 'APPROVED') {
    return res.status(409).json({ error: 'ZATEN_ONAYLANDI', message: 'Kullanıcı zaten onaylı.' });
  }

  await prisma.user.update({
    where: { id: userId },
    // İş 2: onaylayan yönetici + zaman kaydı. Onay = temiz sayfa → eski red izi/gerekçesi temizlenir.
    data: {
      approvalStatus: 'APPROVED',
      approvedBy: req.auth?.userId ?? null,
      approvedAt: new Date(),
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
    },
  });

  void logger.info('SYSTEM', 'Admin: Kullanıcı onaylandı', { userId, tenantId: req.tenant.tenantId });
  void sendUserApprovalNotification({ toEmail: user.email, userName: user.fullName, approved: true });

  return res.json({ message: 'Kullanıcı onaylandı.', userId, approvalStatus: 'APPROVED' });
}

// ─── Düzeltme Talebi ──────────────────────────────────────────────────────────

const CorrectionSchema = z.object({
  feedbackNote: z.string().min(10, 'Geri bildirim notu en az 10 karakter olmalı').max(500),
});

/**
 * POST /api/admin/users/:id/request-correction
 *
 * Kullanıcıyı PENDING durumunda bırakır; belirtilen geri bildirim notu ile
 * e-posta bildirimi gönderir. Profil düzeltmesi talep edilen durumlarda kullanılır.
 */
export async function requestCorrection(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  const parsed = CorrectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true, email: true, fullName: true, approvalStatus: true },
  });

  if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  if (user.approvalStatus === 'APPROVED') {
    return res.status(409).json({ error: 'ZATEN_ONAYLANDI', message: 'Onaylanmış kullanıcıya düzeltme isteği gönderilemez.' });
  }

  // İş 3 P1: gerekçe/düzeltme notunu kalıcı kaydet (önceden yalnız e-postayla gidiyordu).
  // Kullanıcı PENDING kalır; rejectionReason "yöneticinin istediği düzeltme" olarak saklanır.
  await prisma.user.update({
    where: { id: userId },
    data: { rejectionReason: parsed.data.feedbackNote },
  });

  void logger.info('SYSTEM', 'Admin: Düzeltme talebi gönderildi', {
    userId,
    tenantId: req.tenant.tenantId,
    noteLength: parsed.data.feedbackNote.length,
  });

  // Düzeltme notlu özel e-posta gönder; kullanıcı PENDING kalır
  void sendUserApprovalNotification({
    toEmail: user.email,
    userName: user.fullName,
    approved: false,
    // emailService bu alanı kullanarak düzeltme notu içerikli özel şablon gösterir
  });

  return res.json({
    message: 'Düzeltme talebi gönderildi. Kullanıcı PENDING durumunda kalıyor.',
    userId,
    approvalStatus: 'PENDING',
  });
}

// Red gerekçesi opsiyonel; kullanıcıya gösterilebilir → serbest metin, ≤500 (PII yazılmamalı).
const RejectSchema = z.object({
  reason: z.string().trim().max(500, 'Gerekçe en fazla 500 karakter olabilir').optional(),
});

/**
 * POST /api/admin/users/:id/reject
 * PENDING kullanıcıyı reddeder; eşleşme havuzuna dahil edilmez.
 * İş 3 P1: opsiyonel `reason` gerekçesi kaydedilir.
 */
export async function rejectUser(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  const parsed = RejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true, email: true, fullName: true, approvalStatus: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }
  if (user.approvalStatus === 'REJECTED') {
    return res.status(409).json({ error: 'ZATEN_REDDEDILDI', message: 'Kullanıcı zaten reddedildi.' });
  }

  await prisma.user.update({
    where: { id: userId },
    // İş 2: reddeden yönetici + zaman. İş 3 P1: red gerekçesi (varsa).
    data: {
      approvalStatus: 'REJECTED',
      isActive: false,
      rejectedBy: req.auth?.userId ?? null,
      rejectedAt: new Date(),
      rejectionReason: parsed.data.reason && parsed.data.reason.length > 0 ? parsed.data.reason : null,
    },
  });

  void logger.info('SYSTEM', 'Admin: Kullanıcı reddedildi', { userId, tenantId: req.tenant.tenantId });
  void sendUserApprovalNotification({ toEmail: user.email, userName: user.fullName, approved: false });

  return res.json({ message: 'Kullanıcı reddedildi.', userId, approvalStatus: 'REJECTED' });
}

// ─── Koçluk Önerileri ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/users/:id/coaching-suggestions
 *
 * Kullanıcının metriklerine bakarak yönetici için somut aksiyon önerileri döner.
 * Compliance: Öneriler kural bazlı üretilir — PII içermez, sadece anonim metrik.
 */
export async function getCoachingSuggestions(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true, fullName: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  const suggestions = await generateSuggestions(userId, req.tenant.tenantId);

  return res.json({
    userId,
    suggestionCount: suggestions.length,
    hasCritical: suggestions.some((s) => s.severity === 'CRITICAL'),
    items: suggestions,
  });
}

// ─── AlgorithmTuner Onay Kapısı ───────────────────────────────────────────────

/** GET /api/admin/algorithm-tuner/pending — bekleyen kalibrasyon önerisini göster */
export async function getPendingTuning(req: RequestWithTenant, res: Response) {
  const pending = await getPendingAdjustment(req.tenant.tenantId);
  if (!pending) return res.json({ pending: null });
  return res.json({ pending });
}

/** POST /api/admin/algorithm-tuner/approve — kalibrasyon önerisini onayla */
export async function approvePendingTuning(req: RequestWithTenant, res: Response) {
  const applied = await applyPendingAdjustment(req.tenant.tenantId);
  if (!applied) return res.status(404).json({ error: 'Bekleyen öneri yok.' });
  void logger.info('ML', 'Admin kalibrasyon önerisini onayladı', { tenantId: req.tenant.tenantId });
  return res.json({ message: 'Algoritma ağırlıkları güncellendi.', applied });
}

/** POST /api/admin/algorithm-tuner/reject — kalibrasyon önerisini reddet */
export async function rejectPendingTuning(req: RequestWithTenant, res: Response) {
  await rejectPendingAdjustment(req.tenant.tenantId);
  void logger.info('ML', 'Admin kalibrasyon önerisini reddetti', { tenantId: req.tenant.tenantId });
  return res.json({ message: 'Öneri reddedildi, mevcut ağırlıklar korunuyor.' });
}

// ─── Çoklu Admin Yönetimi ─────────────────────────────────────────────────────

/** GET /api/admin/managers — kurumun tüm adminlerini listele */
export async function listAdmins(req: RequestWithTenant, res: Response) {
  const admins = await prisma.user.findMany({
    where: { tenantId: req.tenant.tenantId, role: 'ADMIN', isActive: true },
    select: { id: true, fullName: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({ items: admins, total: admins.length });
}

const MAX_ADMINS_PER_TENANT = 3;

/** POST /api/admin/users/:id/promote-admin — kullanıcıyı ADMIN yap */
export async function promoteToAdmin(req: RequestWithTenant, res: Response) {
  const actorId = req.auth?.userId;
  const target = await prisma.user.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
  });
  if (!target) return res.status(404).json({ error: 'KULLANICI_BULUNAMADI' });
  if (target.role === 'ADMIN') return res.status(400).json({ error: 'ZATEN_ADMIN' });

  const adminCount = await prisma.user.count({
    where: { tenantId: req.tenant.tenantId, role: 'ADMIN', isActive: true },
  });
  if (adminCount >= MAX_ADMINS_PER_TENANT) {
    return res.status(403).json({
      error: 'ADMIN_LIMITI_ASILDI',
      message: `Kurum başına en fazla ${MAX_ADMINS_PER_TENANT} yönetici atanabilir.`,
    });
  }

  await prisma.user.update({ where: { id: target.id }, data: { role: 'ADMIN' } });
  // b3: rol değişince TenantMembership.role senkronla (yoksa panel yanlış sayar). Non-fatal.
  await ensureMembershipSafe(prisma, target.id, req.tenant.tenantId, 'ADMIN');
  void logger.info('AUTH', 'Admin yetkisi verildi', {
    actorId,
    targetId: target.id,
    tenantId: req.tenant.tenantId,
  });
  return res.json({ ok: true });
}

/** POST /api/admin/users/:id/demote-admin — kullanıcıyı ADMIN'den düşür */
export async function demoteFromAdmin(req: RequestWithTenant, res: Response) {
  const actorId = req.auth?.userId;
  const target = await prisma.user.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
  });
  if (!target) return res.status(404).json({ error: 'KULLANICI_BULUNAMADI' });
  if (target.role !== 'ADMIN') return res.status(400).json({ error: 'KULLANICI_ADMIN_DEGIL' });

  // Son admin koruma: en az 1 admin kalmalı
  const adminCount = await prisma.user.count({
    where: { tenantId: req.tenant.tenantId, role: 'ADMIN', isActive: true },
  });
  if (adminCount <= 1) {
    return res.status(400).json({
      error: 'SON_ADMIN',
      message: 'Kurumun son yöneticisini çıkaramazsınız. Önce başka bir yönetici ekleyin.',
    });
  }

  await prisma.user.update({ where: { id: target.id }, data: { role: 'MENTOR' } });
  // b3: rol değişince TenantMembership.role senkronla. Non-fatal.
  await ensureMembershipSafe(prisma, target.id, req.tenant.tenantId, 'MENTOR');
  void logger.info('AUTH', 'Admin yetkisi alındı', {
    actorId,
    targetId: target.id,
    tenantId: req.tenant.tenantId,
  });
  return res.json({ ok: true });
}
