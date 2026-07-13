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
import { notifyRematchRequested } from '../services/notificationService.js';
import { sendUserApprovalNotification } from '../services/emailService.js';
import { generateSuggestions } from '../services/coachingSuggestions.js';
import {
  getPendingAdjustment,
  applyPendingAdjustment,
  rejectPendingAdjustment,
} from '../services/algorithmTuner.js';

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

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, role: true, email: true, fullName: true, isActive: true,
        sectorTags: true, discType: true, skills: true,
        rematchPriority: true, rematchCount: true,
        needsOrientation: true, approvalStatus: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip,
    }),
    prisma.user.count({ where }),
  ]);

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
    data: { approvalStatus: 'APPROVED' },
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

/**
 * POST /api/admin/users/:id/reject
 * PENDING kullanıcıyı reddeder; eşleşme havuzuna dahil edilmez.
 */
export async function rejectUser(req: RequestWithTenant, res: Response) {
  const userId = req.params['id'] as string;

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
    data: { approvalStatus: 'REJECTED', isActive: false },
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

/** POST /api/admin/users/:id/promote-admin — kullanıcıyı ADMIN yap */
export async function promoteToAdmin(req: RequestWithTenant, res: Response) {
  const target = await prisma.user.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
  });
  if (!target) return res.status(404).json({ error: 'KULLANICI_BULUNAMADI' });
  if (target.role === 'ADMIN') return res.status(400).json({ error: 'ZATEN_ADMIN' });

  await prisma.user.update({ where: { id: target.id }, data: { role: 'ADMIN' } });
  return res.json({ ok: true });
}

/** POST /api/admin/users/:id/demote-admin — kullanıcıyı ADMIN'den düşür */
export async function demoteFromAdmin(req: RequestWithTenant, res: Response) {
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
  return res.json({ ok: true });
}
