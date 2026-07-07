/**
 * Menti-Driven Görünürlük Talebi Akışı (Hibrit Akış — Taraf 2)
 *
 * Akış:
 *   1. Menti → POST /mentis/:mentiId/request-visibility  (bu dosya)
 *      → VisibilityOptIn { status: PENDING, initiatedBy: MENTI } oluşturulur
 *   2. Mentor → GET /mentors/:mentorId/pending-visibility-requests  (bu dosya)
 *      → PENDING durumdaki MENTI-kaynaklı talepleri listeler
 *   3. Mentor → PATCH /mentors/:mentorId/visibility-optin/:optInId/respond  (bu dosya)
 *      → APPROVED veya REJECTED → kayıt güncellenir
 *
 * VisibilityOptIn tablosu her iki akış için de ortak kapı görevi görür.
 * APPROVED olan bir kayıt, akıştan bağımsız olarak MatchRequest oluşturulmasına izin verir.
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { canCrossTenantMatch } from '../services/tenantSharing.js';

// ─── 1. Menti → Görünürlük Talebi Gönder ─────────────────────────────────────

const RequestVisibilitySchema = z.object({
  mentorId: z.string().min(5),
  requestMessage: z.string().max(500).optional(),
});

/**
 * POST /mentis/:mentiId/request-visibility
 * Menti, belirli bir mentora görünürlük talebi gönderir.
 * Mevcut bir APPROVED kayıt varsa işlem reddedilir (zaten eşleşmiş).
 */
export async function requestVisibilityFromMentor(req: RequestWithTenant, res: Response) {
  const mentiId = req.params['mentiId'] as string;

  // Yetki: sadece menti kendi adına veya admin yapabilir
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Kimlik doğrulaması gerekli.' });
  }
  const isSelf = req.auth.userId === mentiId;
  const isAdmin = req.auth.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ', message: 'Yalnızca kendi talebinizi gönderebilirsiniz.' });
  }

  const parsed = RequestVisibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  // Menti doğrulaması
  const menti = await prisma.user.findFirst({
    where: { id: mentiId, tenantId: req.tenant.tenantId, role: 'MENTI', isActive: true },
    select: { id: true, fullName: true, sectorTags: true, discType: true, skills: true, interactionStyle: true, expectationCategories: true, tenantId: true },
  });
  if (!menti) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Aktif menti bulunamadı.' });
  }

  // Self-request koruması
  if (menti.id === parsed.data.mentorId) {
    return res.status(400).json({ error: 'SELF_REQUEST_YASAK', message: 'Kendi kendinize görünürlük talebi gönderemezsiniz.' });
  }

  // Mentor doğrulaması — cross-tenant kasıtlı: mentor farklı tenant'ta olabilir.
  // canCrossTenantMatch çağrısı hemen ardından izin kontrolü yapar.
  const mentor = await prisma.user.findFirst({
    where: { id: parsed.data.mentorId, role: 'MENTOR', isActive: true },
    select: { id: true, fullName: true, tenantId: true, sectorTags: true, discType: true, interactionStyle: true },
  });
  if (!mentor) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Aktif mentor bulunamadı.' });
  }

  // Cross-tenant izin kontrolü
  const crossAllowed = await canCrossTenantMatch({
    requesterTenantId: req.tenant.tenantId,
    targetTenantId: mentor.tenantId,
  });
  if (!crossAllowed) {
    return res.status(403).json({
      error: 'SHARED_POOL_KAPALI',
      message: 'Bu mentorun tenant havuzu kapalı olduğu için görünürlük talebi gönderilemez.',
    });
  }

  // Mevcut kayıt kontrolü
  const existing = await prisma.visibilityOptIn.findUnique({
    where: { mentorId_mentiId: { mentorId: mentor.id, mentiId: menti.id } },
    select: { id: true, status: true, initiatedBy: true },
  });

  if (existing?.status === 'APPROVED') {
    return res.status(409).json({
      error: 'ZATEN_ESLESTIRILDI',
      message: 'Bu mentor ile zaten görünürlük onayı mevcut.',
      optInId: existing.id,
    });
  }

  if (existing?.status === 'PENDING') {
    return res.status(409).json({
      error: 'TALEP_BEKLEMEDE',
      message: 'Bu mentor için zaten bekleyen bir talep var.',
      optInId: existing.id,
    });
  }

  // REJECTED veya yoksa: yeni PENDING kayıt oluştur
  const optIn = await prisma.visibilityOptIn.upsert({
    where: { mentorId_mentiId: { mentorId: mentor.id, mentiId: menti.id } },
    update: {
      status: 'PENDING',
      initiatedBy: 'MENTI',
      requestMessage: parsed.data.requestMessage ?? null,
    },
    create: {
      tenantId: req.tenant.tenantId,
      mentorId: mentor.id,
      mentiId: menti.id,
      status: 'PENDING',
      initiatedBy: 'MENTI',
      requestMessage: parsed.data.requestMessage ?? null,
    },
  });

  return res.status(201).json({
    message: 'Görünürlük talebi gönderildi. Mentor onayı bekleniyor.',
    optInId: optIn.id,
    status: optIn.status,
    mentorId: mentor.id,
    mentorName: mentor.fullName,
  });
}

// ─── 2. Mentor → Bekleyen Talepleri Listele ──────────────────────────────────

const PendingListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * GET /mentors/:mentorId/pending-visibility-requests
 * Mentor, menti-kaynaklı bekleyen görünürlük taleplerini görür.
 */
export async function getPendingVisibilityRequests(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;

  // Yetki: mentor kendi gelen taleplerini veya admin görebilir
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Kimlik doğrulaması gerekli.' });
  }
  const isSelf = req.auth.userId === mentorId;
  const isAdmin = req.auth.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ', message: 'Yalnızca kendi gelen taleplerinizi görüntüleyebilirsiniz.' });
  }

  const parsed = PendingListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const mentor = await prisma.user.findFirst({
    where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR', isActive: true },
    select: { id: true },
  });
  if (!mentor) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  }

  const [items, total] = await Promise.all([
    prisma.visibilityOptIn.findMany({
      where: {
        mentorId: mentor.id,
        initiatedBy: 'MENTI',
        status: 'PENDING',
      },
      select: {
        id: true,
        status: true,
        initiatedBy: true,
        requestMessage: true,
        createdAt: true,
        menti: {
          select: {
            id: true,
            fullName: true,
            discType: true,
            sectorTags: true,
            expectationCategories: true,
            interactionStyle: true,
            timeCommitment: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
      skip: parsed.data.offset,
    }),
    prisma.visibilityOptIn.count({
      where: { mentorId: mentor.id, initiatedBy: 'MENTI', status: 'PENDING' },
    }),
  ]);

  return res.json({ items, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

// ─── 3. Mentor → Talebi Onayla / Reddet ─────────────────────────────────────

const RespondSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

/**
 * PATCH /mentors/:mentorId/visibility-optin/:optInId/respond
 * Mentor, menti-kaynaklı bir talebi onaylar veya reddeder.
 */
export async function respondToVisibilityRequest(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;
  const optInId = req.params['optInId'] as string;

  // Yetki: sadece mentor veya admin
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Kimlik doğrulaması gerekli.' });
  }
  const isSelf = req.auth.userId === mentorId;
  const isAdmin = req.auth.role === 'ADMIN';
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ', message: 'Yalnızca kendi gelen taleplerinize yanıt verebilirsiniz.' });
  }

  const parsed = RespondSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const optIn = await prisma.visibilityOptIn.findFirst({
    where: { id: optInId, mentorId, status: 'PENDING', initiatedBy: 'MENTI' },
    select: { id: true, mentiId: true, tenantId: true },
  });

  if (!optIn) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Bekleyen talep bulunamadı. Zaten yanıtlanmış veya bu mentora ait değil.',
    });
  }

  const updated = await prisma.visibilityOptIn.update({
    where: { id: optIn.id },
    data: { status: parsed.data.decision },
    select: {
      id: true,
      status: true,
      initiatedBy: true,
      updatedAt: true,
    },
  });

  return res.json({
    message:
      parsed.data.decision === 'APPROVED'
        ? 'Talep onaylandı. Menti artık profil detaylarınıza erişebilir ve eşleşme isteği gönderebilir.'
        : 'Talep reddedildi.',
    ...updated,
  });
}
