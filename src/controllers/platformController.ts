import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { signToken, PLATFORM_AUDIENCE } from '../middleware/jwtAuth.js';
import { logger } from '../services/logger.js';
import { auditPlatformAction } from '../services/platformAudit.js';
import { detectAnomalies } from '../services/abuseDetection.service.js';

export const PLATFORM_COOKIE = 'platform_token';
export const PLATFORM_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  maxAge:   60 * 60 * 1000, // 1 saat (ms)
  path:     '/api/platform',
};

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Uzunluk farkı timing side-channel yaratmamak için sabit-zaman dummy karşılaştırma
  if (bufA.length !== bufB.length) {
    timingSafeEqual(Buffer.alloc(bufA.length), Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// POST /api/platform/auth
export async function platformLogin(req: Request, res: Response) {
  const { email, password } = req.body as { email?: string; password?: string };

  const emailOk    = !!email    && safeEqual(email,    config.platformAdminEmail);
  const passwordOk = !!password && safeEqual(password, config.platformAdminKey);

  if (!emailOk || !passwordOk) {
    void logger.warn('AUTH', 'Platform login başarısız', {
      email: email ?? '(boş)',
      ip:    req.ip ?? 'unknown',
    });
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Geçersiz platform yönetici bilgileri.' });
  }

  const token = signToken(
    {
      sub: 'platform-admin',
      tenantId: '__platform__',
      role: 'ADMIN',
      fullName: 'Platform Yöneticisi',
      isPlatformAdmin: true,
    },
    { audience: PLATFORM_AUDIENCE },
  );

  res.cookie(PLATFORM_COOKIE, token, PLATFORM_COOKIE_OPTS);
  return res.json({ ok: true });
}

// POST /api/platform/logout
export async function platformLogout(_req: Request, res: Response) {
  res.clearCookie(PLATFORM_COOKIE, { ...PLATFORM_COOKIE_OPTS, maxAge: 0 });
  return res.json({ ok: true });
}

// GET /api/platform/stats
export async function getPlatformStats(_req: Request, res: Response) {
  const [
    tenantCount,
    userCount,
    mentorCount,
    mentiCount,
    adminCount,
    meetingCount,
    pendingMeetingCount,
    completedMeetingCount,
    pendingTenantCount,
    unreviewedReportCount,
    recentLogs,
    tenants,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'MENTOR' } }),
    prisma.user.count({ where: { role: 'MENTI' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.meeting.count(),
    prisma.meeting.count({ where: { status: 'PENDING' } }),
    prisma.meeting.count({ where: { status: 'COMPLETED' } }),
    prisma.tenant.count({ where: { verificationStatus: 'PENDING_REVIEW' } }),
    prisma.suspicionReport.count({ where: { reviewed: false } }),
    prisma.systemLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        displayName: true,
        primaryColor: true,
        logoUrl: true,
        isSharedPoolActive: true,
        isActive: true,
        verificationStatus: true,
        createdAt: true,
        _count: { select: { users: true, meetings: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return res.json({
    totals: {
      tenants: tenantCount,
      users: userCount,
      mentors: mentorCount,
      mentis: mentiCount,
      admins: adminCount,
      meetings: meetingCount,
      pendingMeetings: pendingMeetingCount,
      completedMeetings: completedMeetingCount,
      pendingTenants: pendingTenantCount,
      unreviewedReports: unreviewedReportCount,
    },
    tenants,
    recentLogs,
  });
}

// GET /api/platform/health
export async function getPlatformHealth(_req: Request, res: Response) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const mem = process.memoryUsage();

    // Mail: SMTP yapılandırması tam mı? Canlı gönderim testi YAPILMAZ (gerçek kullanıcıya
    // bounce/spam riski) — yalnızca env yapılandırmasının varlığı kontrol edilir.
    const mailConfigured = !!(config.email.smtpHost && config.email.smtpUser && config.email.smtpPass);

    // Son 24 saatteki kritik hata sayısı (SystemLog ERROR) — "kırmızı" sinyali.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentErrors = await prisma.systemLog.count({ where: { level: 'ERROR', createdAt: { gte: since } } });

    return res.json({
      status: 'ok',
      db: 'connected',
      mail: mailConfigured ? 'configured' : 'not_configured',
      recentErrors,
      env: config.nodeEnv,
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
      nodeVersion: process.version,
    });
  } catch {
    return res.status(503).json({ status: 'error', db: 'disconnected' });
  }
}

// GET /api/platform/logs
export async function getPlatformLogs(req: Request, res: Response) {
  const limit = Math.min(Number(req.query['limit'] ?? 100), 500);
  const level = req.query['level'] as string | undefined;
  const category = req.query['category'] as string | undefined;

  const where: Record<string, unknown> = {};
  if (level) where['level'] = level;
  if (category) where['category'] = category;

  const [logs, total] = await Promise.all([
    prisma.systemLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.systemLog.count({ where }),
  ]);

  return res.json({ items: logs, total });
}

// GET /api/platform/tenants/pending
export async function listPendingTenants(_req: Request, res: Response) {
  const tenants = await prisma.tenant.findMany({
    where: { verificationStatus: 'PENDING_REVIEW' },
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      isActive: true,
      verificationStatus: true,
      verificationNote: true,
      createdAt: true,
      users: {
        where: { role: 'ADMIN' },
        select: { fullName: true, email: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({ items: tenants, total: tenants.length });
}

// GET /api/platform/tenants
export async function listAllTenants(req: Request, res: Response) {
  const page = Math.max(1, Number(req.query['page'] ?? 1));
  const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        displayName: true,
        slug: true,
        isActive: true,
        verificationStatus: true,
        plan: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.tenant.count(),
  ]);

  return res.json({ items, total, page, limit });
}

// POST /api/platform/tenants/:id/approve
export async function approveTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { verificationStatus: 'APPROVED', verifiedAt: new Date() },
  });

  await auditPlatformAction('APPROVE_TENANT', req, { targetType: 'TENANT', targetTenantId: tenant.id });
  return res.json({ ok: true });
}

// POST /api/platform/tenants/:id/reject
const RejectTenantSchema = z.object({ note: z.string().min(1).optional() });

export async function rejectTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' });

  const parsed = RejectTenantSchema.safeParse(req.body);
  const note = parsed.success ? (parsed.data.note ?? null) : null;

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      verificationStatus: 'REJECTED',
      verificationNote: note,
      verifiedAt: new Date(),
    },
  });

  await auditPlatformAction('REJECT_TENANT', req, { targetType: 'TENANT', targetTenantId: tenant.id });
  return res.json({ ok: true });
}

// POST /api/platform/tenants/:id/freeze
export async function freezeTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
  await auditPlatformAction('FREEZE_TENANT', req, { targetType: 'TENANT', targetTenantId: tenant.id });
  return res.json({ ok: true });
}

// POST /api/platform/tenants/:id/activate
export async function activateTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: true } });
  await auditPlatformAction('ACTIVATE_TENANT', req, { targetType: 'TENANT', targetTenantId: tenant.id });
  return res.json({ ok: true });
}

// GET /api/platform/suspicion-reports
export async function listSuspicionReports(req: Request, res: Response) {
  const reviewedParam = req.query['reviewed'];
  const reviewed = reviewedParam === 'true' ? true : reviewedParam === 'false' ? false : undefined;

  const where = reviewed !== undefined ? { reviewed } : {};
  const items = await prisma.suspicionReport.findMany({ where, orderBy: { createdAt: 'desc' } });

  return res.json({ items, total: items.length });
}

// POST /api/platform/suspicion-reports/:id/review
const ReviewReportSchema = z.object({ note: z.string().optional() });

export async function reviewSuspicionReport(req: Request, res: Response) {
  const report = await prisma.suspicionReport.findUnique({ where: { id: req.params['id'] as string } });
  if (!report) return res.status(404).json({ error: 'NOT_FOUND' });

  const parsed = ReviewReportSchema.safeParse(req.body);
  const note = parsed.success ? parsed.data.note : undefined;

  await prisma.suspicionReport.update({
    where: { id: report.id },
    data: { reviewed: true, reviewNote: note },
  });

  await auditPlatformAction('REVIEW_SUSPICION_REPORT', req, { targetType: 'SUSPICION_REPORT', targetId: report.id });
  return res.json({ ok: true });
}

// ─── Kullanıcı Şikayetleri (sistem-geneli) + Otomatik Tespit ──────────────────

// GET /api/platform/user-reports?status=OPEN|REVIEWED|DISMISSED
export async function listUserReports(req: Request, res: Response) {
  const statusRaw = req.query['status'] as string | undefined;
  const status = statusRaw && ['OPEN', 'REVIEWED', 'DISMISSED'].includes(statusRaw) ? statusRaw : undefined;

  const reports = await prisma.userReport.findMany({
    where: status ? { status } : {},
    select: {
      id: true, tenantId: true, reason: true, description: true, status: true, reviewNote: true, createdAt: true,
      reporter: { select: { fullName: true } },
      target: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Kurum adlarını tek sorguda ekle (UserReport'ta Tenant ilişkisi yok — hafif join).
  const tenantIds = [...new Set(reports.map((r) => r.tenantId))];
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true, displayName: true },
  });
  const nameById = new Map(tenants.map((t) => [t.id, t.displayName ?? t.name]));
  const items = reports.map((r) => ({ ...r, tenantName: nameById.get(r.tenantId) ?? r.tenantId }));

  // KVKK: platform admin kullanıcı şikayetlerini (PII içerir) görüntüledi → denetim izi.
  await auditPlatformAction('VIEW_USER_REPORTS', req, { count: items.length });

  return res.json({ items, total: items.length });
}

// PATCH /api/platform/user-reports/:id
const PlatformReviewReportSchema = z.object({
  status: z.enum(['REVIEWED', 'DISMISSED']),
  note: z.string().trim().max(1000).optional(),
});

export async function reviewUserReport(req: Request, res: Response) {
  const parsed = PlatformReviewReportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });

  const report = await prisma.userReport.findUnique({ where: { id: req.params['id'] as string }, select: { id: true } });
  if (!report) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.userReport.update({
    where: { id: report.id },
    data: { status: parsed.data.status, reviewNote: parsed.data.note, reviewedBy: 'platform-admin' },
  });

  await auditPlatformAction('REVIEW_USER_REPORT', req, { targetType: 'USER_REPORT', targetId: report.id });
  return res.json({ ok: true });
}

// GET /api/platform/anomalies — basit otomatik tespit (sistem-geneli işaretli kullanıcılar)
export async function getAnomalies(req: Request, res: Response) {
  const items = await detectAnomalies();
  await auditPlatformAction('VIEW_ANOMALIES', req, { count: items.length });
  return res.json({ items, total: items.length });
}
