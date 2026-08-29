import { z } from 'zod';
import type { Request, Response } from 'express';
import { prisma } from '../db.js';
import { extractBearerToken, verifyToken } from '../middleware/jwtAuth.js';
import { invalidateTenant } from '../services/tenantCache.js';
import { logger } from '../services/logger.js';

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

/**
 * DB'den okunan blockedPairs JSON blob'unu güvenli şekilde parse eder.
 * - Array değilse boş dizi döner (bozuk blob koruması)
 * - Her kaydın zorunlu alanlarını doğrular; bozuk kayıtları sessizce filtreler
 * - Kendi kendini bloke eden ve duplicate kayıtları normalleştirir
 */
function sanitizeBlockedPairs(raw: unknown): BlockedPairRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((item): item is BlockedPairRecord => {
    if (typeof item !== 'object' || item === null) return false;
    const r = item as Record<string, unknown>;
    if (
      typeof r['fromUserId'] !== 'string' || r['fromUserId'].length === 0 ||
      typeof r['toUserId']   !== 'string' || r['toUserId'].length   === 0 ||
      typeof r['blockedAt']  !== 'string' ||
      typeof r['blockedBy']  !== 'string'
    ) return false;
    // Self-block filtrele
    if (r['fromUserId'] === r['toUserId']) return false;
    // Yön-bağımsız duplicate filtrele
    const key = [r['fromUserId'], r['toUserId']].sort().join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── PATCH /api/tenants/:id/settings ─────────────────────────────────────────
// Sınırlar: maxMeetingsPerWeek 1-5, minMatchScoreThreshold %20-%90.
// Panel bypass'ı veya negatif değer gönderimlerine karşı Zod katmanında çıpa.

const UpdateSettingsSchema = z
  .object({
    maxMeetingsPerWeek:     z.number().int().min(1).max(5).optional(),
    minMatchScoreThreshold: z.number().int().min(20).max(90).optional(),
    reportingFrequency:     z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']).optional(),
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

  // Denetim izi (G1-14/G1-15): program ayarı değişikliği kim/ne zaman/hangi alanlar.
  // PII YOK — yalnız actorId + tenantId + değişen alan ADLARI (değerler değil) loglanır.
  void logger.info('AUDIT', 'Tenant program ayarları güncellendi', {
    actorId: payload.sub,
    tenantId,
    changedFields: Object.keys(parsed.data),
  });

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

  // sanitizeBlockedPairs: bozuk blob, self-block ve duplicate kayıtları temizler.
  const current = sanitizeBlockedPairs(tenant.blockedPairs);

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
// PII Güvenlik Notu: Prisma select whitelist zorunludur.
// blockedPairs (userId içerir), limits, tenantVocabulary, kullanıcı verisi asla dönmez.
// Yeni alan eklenirken bu listeye explicit eklenmesi gerekir — ham obje asla sızdırılmaz.

type TenantSummaryDto = {
  id:        string;
  name:      string;
  slug:      string;
  plan:      string;
  isActive:  boolean;
  createdAt: Date;
  _count:    { users: number; meetings: number };
};

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
    // Tenant listesi — yalnızca PII-safe özet alanlar (TenantSummaryDto)
    prisma.tenant.findMany({
      select: {
        id:       true,
        name:     true,
        slug:     true,
        plan:     true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true, meetings: true } },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<TenantSummaryDto[]>,
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

// ─── GET /api/super-admin/tenants/pending ─────────────────────────────────────

export async function listPendingTenants(_req: Request, res: Response) {
  const tenants = await prisma.tenant.findMany({
    where: { verificationStatus: 'PENDING_REVIEW' },
    select: {
      id:                 true,
      name:               true,
      displayName:        true,
      slug:               true,
      verificationStatus: true,
      verificationNote:   true,
      createdAt:          true,
      users: {
        where: { role: 'ADMIN' },
        select: { id: true, email: true, fullName: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({ items: tenants, total: tenants.length });
}

// ─── PATCH /api/super-admin/tenants/:id/verify ────────────────────────────────

const VerifyTenantSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note:   z.string().max(500).optional(),
});

export async function verifyTenant(req: Request, res: Response) {
  const parsed = VerifyTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const tenantId = req.params['id'] as string;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { id: true, slug: true, verificationStatus: true },
  });
  if (!tenant) {
    return res.status(404).json({ error: 'TENANT_BULUNAMADI', message: 'Kurum bulunamadı.' });
  }

  if (tenant.verificationStatus !== 'PENDING_REVIEW') {
    return res.status(409).json({
      error:   'DURUM_UYGUN_DEGIL',
      message: 'Yalnızca PENDING_REVIEW durumundaki kurumlar doğrulanabilir.',
    });
  }

  const { action, note } = parsed.data;

  if (action === 'approve') {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        verificationStatus: 'APPROVED',
        verifiedAt: new Date(),
        ...(note && { verificationNote: note }),
      },
      select: { id: true, name: true, slug: true, verificationStatus: true },
    });

    invalidateTenant(tenantId);
    return res.json({ message: 'Kurum onaylandı.', tenant: updated });
  }

  // reject: slug'ı serbest bırak → yeni tenant aynı slug'ı alabilsin
  const rejectedSlug = `__rej_${tenant.slug}_${Date.now()}`;
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      verificationStatus: 'REJECTED',
      isActive: false,
      slug: rejectedSlug,
      verifiedAt: new Date(),
      ...(note && { verificationNote: note }),
    },
    select: { id: true, name: true, slug: true, verificationStatus: true },
  });

  invalidateTenant(tenantId);
  return res.json({ message: 'Kurum reddedildi. Orijinal slug serbest bırakıldı.', tenant: updated });
}
