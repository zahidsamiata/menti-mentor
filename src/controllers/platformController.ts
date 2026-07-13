import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { signToken } from '../middleware/jwtAuth.js';
import { logger } from '../services/logger.js';

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

  const token = signToken({
    sub: 'platform-admin',
    tenantId: '__platform__',
    role: 'ADMIN',
    fullName: 'Platform Yöneticisi',
    isPlatformAdmin: true,
  });

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
    return res.json({
      status: 'ok',
      db: 'connected',
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

  return res.json({ ok: true });
}

// POST /api/platform/tenants/:id/freeze
export async function freezeTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
  return res.json({ ok: true });
}

// POST /api/platform/tenants/:id/activate
export async function activateTenant(req: Request, res: Response) {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params['id'] as string } });
  if (!tenant) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: true } });
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

  return res.json({ ok: true });
}
