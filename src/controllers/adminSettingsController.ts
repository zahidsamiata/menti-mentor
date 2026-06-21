import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { extractBearerToken, verifyToken } from '../middleware/jwtAuth.js';
import { invalidateTenant } from '../services/tenantCache.js';

// ─── Ortak Yardımcı: Tenant ADMIN JWT doğrulaması ────────────────────────────
// selfServeController'daki extractAdminPayload ile aynı pattern.

function extractAdminPayload(req: Request, res: Response) {
  const token = extractBearerToken(req.header('Authorization'));
  if (!token) {
    res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'JWT token gereklidir.' });
    return null;
  }
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'ADMIN') {
    res.status(403).json({ error: 'YETKI_YOK', message: 'Bu işlem için yönetici yetkisi gereklidir.' });
    return null;
  }
  return payload;
}

// ─── blockedPairs kayıt yapısı ────────────────────────────────────────────────

interface BlockedPairRecord {
  fromUserId: string;
  toUserId:   string;
  blockedAt:  string;
  blockedBy:  string; // adminUserId
}

// ─── PATCH /api/tenants/:id/settings ─────────────────────────────────────────

const UpdateSettingsSchema = z
  .object({
    maxMeetingsPerWeek:     z.number().int().min(1).max(7).optional(),
    minMatchScoreThreshold: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'En az bir ayar alanı gönderilmelidir.' },
  );

export async function updateTenantSettings(req: Request, res: Response) {
  const payload = extractAdminPayload(req, res);
  if (!payload) return;

  const tenantId = req.params['id'] as string;

  if (payload.tenantId !== tenantId) {
    return res.status(403).json({
      error:   'YETKI_YOK',
      message: 'Başka bir kurumun ayarlarını güncelleyemezsiniz.',
    });
  }

  const parsed = UpdateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data:  parsed.data,
    select: {
      id:                     true,
      name:                   true,
      slug:                   true,
      maxMeetingsPerWeek:     true,
      minMatchScoreThreshold: true,
      updatedAt:              true,
    },
  });

  invalidateTenant(tenantId);

  return res.json({
    message: 'Program ayarları güncellendi.',
    settings: {
      maxMeetingsPerWeek:     updated.maxMeetingsPerWeek,
      minMatchScoreThreshold: updated.minMatchScoreThreshold,
    },
    tenant: { id: updated.id, name: updated.name, slug: updated.slug },
    updatedAt: updated.updatedAt,
  });
}

// ─── POST /api/tenants/:id/block-pair ────────────────────────────────────────

const BlockPairSchema = z.object({
  fromUserId: z.string().min(1, 'fromUserId zorunludur.'),
  toUserId:   z.string().min(1, 'toUserId zorunludur.'),
});

export async function blockPair(req: Request, res: Response) {
  const payload = extractAdminPayload(req, res);
  if (!payload) return;

  const tenantId = req.params['id'] as string;

  if (payload.tenantId !== tenantId) {
    return res.status(403).json({
      error:   'YETKI_YOK',
      message: 'Başka bir kurumda kullanıcı engelleyemezsiniz.',
    });
  }

  const parsed = BlockPairSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { fromUserId, toUserId } = parsed.data;

  if (fromUserId === toUserId) {
    return res.status(400).json({
      error:   'GECERSIZ_ESLESME',
      message: 'Bir kullanıcı kendisiyle engellenemez.',
    });
  }

  // Her iki kullanıcının aynı tenant'a ait olduğunu doğrula
  const users = await prisma.user.findMany({
    where: { id: { in: [fromUserId, toUserId] }, tenantId },
    select: { id: true, fullName: true },
  });

  if (users.length !== 2) {
    return res.status(404).json({
      error:   'KULLANICI_BULUNAMADI',
      message: 'Belirtilen kullanıcılardan biri veya ikisi bu kurumda bulunamadı.',
    });
  }

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, blockedPairs: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  // Runtime guard: TypeScript cast'i bozuk JSON blob'a karşı yetmez; Array.isArray zorunlu.
  const raw     = tenant.blockedPairs;
  const current: BlockedPairRecord[] = Array.isArray(raw) ? (raw as unknown as BlockedPairRecord[]) : [];

  // Yön bağımsız çakışma kontrolü: A→B veya B→A zaten varsa reddet
  const alreadyBlocked = current.some(
    (p) =>
      (p.fromUserId === fromUserId && p.toUserId === toUserId) ||
      (p.fromUserId === toUserId   && p.toUserId === fromUserId),
  );
  if (alreadyBlocked) {
    return res.status(409).json({
      error:   'ENGEL_MEVCUT',
      message: 'Bu kullanıcı çifti zaten engellenmiş.',
    });
  }

  const newRecord: BlockedPairRecord = {
    fromUserId,
    toUserId,
    blockedAt: new Date().toISOString(),
    blockedBy: payload.sub,
  };

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data:  { blockedPairs: [...current, newRecord] },
    select: { id: true, blockedPairs: true },
  });

  invalidateTenant(tenantId);

  const fromUser = users.find((u) => u.id === fromUserId);
  const toUser   = users.find((u) => u.id === toUserId);

  return res.status(201).json({
    message:  'Kullanıcı çifti başarıyla engellendi.',
    blocked:  newRecord,
    fromUser: { id: fromUser!.id, fullName: fromUser!.fullName },
    toUser:   { id: toUser!.id,   fullName: toUser!.fullName   },
    totalBlockedPairs: Array.isArray(updated.blockedPairs) ? updated.blockedPairs.length : 0,
  });
}

// ─── GET /api/super-admin/dashboard ──────────────────────────────────────────

export async function getSuperAdminDashboard(_req: Request, res: Response) {
  const [
    totalTenants,
    activeTenants,
    totalActiveUsers,
    totalMentors,
    totalMentis,
    completedMeetingAgg,
    tenantList,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: 'MENTOR', isActive: true } }),
    prisma.user.count({ where: { role: 'MENTI',  isActive: true } }),
    // Tamamlanan görüşmelerin toplam dakikası
    prisma.meeting.aggregate({
      _sum: { durationMin: true },
      where: { status: 'COMPLETED' },
    }),
    // Tenant listesi — özet istatistiklerle
    prisma.tenant.findMany({
      select: {
        id:      true,
        name:    true,
        slug:    true,
        plan:    true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            users:    true,
            meetings: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const totalMentoringMinutes = completedMeetingAgg._sum.durationMin ?? 0;
  const totalMentoringHours   = Math.round((totalMentoringMinutes / 60) * 10) / 10;

  return res.json({
    platform: {
      totalTenants,
      activeTenants,
      suspendedTenants: totalTenants - activeTenants,
      totalActiveUsers,
      totalMentors,
      totalMentis,
      totalMentoringHours,
      totalMentoringMinutes,
    },
    tenants: tenantList,
    generatedAt: new Date().toISOString(),
  });
}

// ─── PATCH /api/super-admin/tenants/:id/status ───────────────────────────────

const UpdateTenantStatusSchema = z.object({
  isActive: z.boolean(),
});

export async function updateTenantStatus(req: Request, res: Response) {
  const parsed = UpdateTenantStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const tenantId = req.params['id'] as string;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, name: true, isActive: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  if (tenant.isActive === parsed.data.isActive) {
    const state = parsed.data.isActive ? 'zaten aktif' : 'zaten askıya alınmış';
    return res.status(409).json({
      error:   'DURUM_DEGISMEDI',
      message: `Bu kurum ${state}.`,
    });
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data:  { isActive: parsed.data.isActive },
    select: {
      id:        true,
      name:      true,
      slug:      true,
      isActive:  true,
      updatedAt: true,
    },
  });

  invalidateTenant(tenantId);

  const action = parsed.data.isActive ? 'aktif edildi' : 'askıya alındı';

  return res.json({
    message:  `Kurum başarıyla ${action}.`,
    tenant:   updated,
  });
}
