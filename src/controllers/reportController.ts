import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';

const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'NO_SHOW', 'OTHER'] as const;

const CreateReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  description: z.string().trim().max(1000).optional(),
});

/**
 * POST /api/users/:id/report — giriş yapmış kullanıcı, :id kullanıcıyı şikayet eder.
 * Güvenlik: tenant izolasyonu (hedef aynı kurumda), kendini şikayet engeli, tekrar (spam) engeli.
 */
export async function createReport(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const targetId = req.params['id'] as string;
  if (targetId === req.auth.userId) {
    return res.status(400).json({ error: 'GECERSIZ_HEDEF', message: 'Kendinizi şikayet edemezsiniz.' });
  }

  const parsed = CreateReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const tenantId = req.tenant.tenantId;
  const target = await prisma.user.findFirst({
    where: { id: targetId, tenantId },
    select: { id: true },
  });
  if (!target) return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });

  // Spam engeli: aynı kişiye açık (OPEN) bir şikayet zaten varsa tekrarını engelle.
  const existing = await prisma.userReport.findFirst({
    where: { tenantId, reporterUserId: req.auth.userId, targetUserId: targetId, status: 'OPEN' },
    select: { id: true },
  });
  if (existing) {
    return res.status(409).json({ error: 'ZATEN_SIKAYET', message: 'Bu kullanıcı için zaten bir şikayetiniz inceleniyor.' });
  }

  const report = await prisma.userReport.create({
    data: {
      tenantId,
      reporterUserId: req.auth.userId,
      targetUserId: targetId,
      reason: parsed.data.reason,
      description: parsed.data.description,
    },
    select: { id: true },
  });

  return res.status(201).json({ ok: true, id: report.id });
}

// ─── Tenant admin: kendi kurumunun şikayetleri ────────────────────────────────

const ReportListSchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional(),
});

const REPORT_SELECT = {
  id: true,
  reason: true,
  description: true,
  status: true,
  reviewNote: true,
  createdAt: true,
  reporter: { select: { id: true, fullName: true } },
  target: { select: { id: true, fullName: true } },
} as const;

/** GET /api/admin/reports — ADMIN kendi tenant'ının şikayetlerini görür. */
export async function listTenantReports(req: RequestWithTenant, res: Response) {
  const parsed = ReportListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });

  const items = await prisma.userReport.findMany({
    where: { tenantId: req.tenant.tenantId, ...(parsed.data.status ? { status: parsed.data.status } : {}) },
    select: REPORT_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return res.json({ items, total: items.length });
}

const ReviewReportSchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED']),
  note: z.string().trim().max(1000).optional(),
});

/** PATCH /api/admin/reports/:id — ADMIN kendi tenant'ının şikayetini inceler/kapatır. */
export async function reviewTenantReport(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const parsed = ReviewReportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });

  // Tenant izolasyonu: rapor bu tenant'a ait olmalı.
  const report = await prisma.userReport.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
    select: { id: true },
  });
  if (!report) return res.status(404).json({ error: 'NOT_FOUND', message: 'Şikayet bulunamadı.' });

  await prisma.userReport.update({
    where: { id: report.id },
    data: { status: parsed.data.status, reviewNote: parsed.data.note, reviewedBy: req.auth.userId },
  });

  return res.json({ ok: true });
}
