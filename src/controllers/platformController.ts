import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { signToken } from '../middleware/jwtAuth.js';

// POST /api/platform/auth
export async function platformLogin(req: Request, res: Response) {
  const { key } = req.body as { key?: string };
  if (!key || key !== config.platformAdminKey) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Geçersiz platform yönetici anahtarı.' });
  }

  const token = signToken({
    sub: 'platform-admin',
    tenantId: '__platform__',
    role: 'ADMIN',
    fullName: 'Platform Yöneticisi',
    isPlatformAdmin: true,
  });

  return res.json({ accessToken: token, expiresIn: config.jwt.expiresIn });
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
