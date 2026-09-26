import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { parsePagination, LIST_PAGE } from '../services/pagination.js';
import { notifyMatchRequestReceived } from '../services/notificationService.js';
import { canCrossTenantMatch } from '../services/tenantSharing.js';
import { isPairBlockedInTenants } from '../services/pairBlockGuard.js';
import { validateRequest } from '../middleware/validate.js';

// Not: requesterUserId body'de ALINMAZ — talep sahibi kimliği doğrulanmış kullanıcıdır
// (IDOR önleme). Aksi halde bir kullanıcı başkası adına talep oluşturabilirdi.
const CreateRequestSchema = z.object({
  targetType: z.enum(['USER', 'JOB_LISTING']),
  targetId: z.string().min(5),
  // Menti kendi tanışma/talep mesajını yazar — AI üretimi yok.
  requestMessage: z.string().min(1, 'Talep mesajı boş olamaz.').max(1000).optional(),
});

// Menti → Mentor doğrudan talep (VisibilityOptIn onay adımı kaldırıldı).
// Polymorphic target: USER (mentor) veya JOB_LISTING.
export async function createMatchRequest(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });
  }
  const parsed = validateRequest(CreateRequestSchema, req.body, res);
  if (!parsed.success) return parsed.response;

  // Talep sahibi = kimliği doğrulanmış kullanıcı (body'den değil), kendi tenant'ında aktif.
  const requester = await prisma.user.findFirst({
    where: { id: req.auth.userId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true },
  });
  if (!requester) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requester kullanıcı bulunamadı.' });
  }

  if (parsed.data.targetType === 'USER') {
    // Hedef mentör başka tenant'ta olabilir (shared pool). findUnique RLS'ten muaftır
    // (bkz. db.ts) — cross-tenant bulur; ardından canCrossTenantMatch paylaşım iznini zorlar.
    // Guard olmadan bu, herhangi bir tenant'ın mentörüne talep gönderilmesine izin verirdi.
    const target = await prisma.user.findUnique({
      where: { id: parsed.data.targetId },
      select: { id: true, role: true, isActive: true, tenantId: true },
    });
    if (!target || target.role !== 'MENTOR' || !target.isActive) {
      return res.status(400).json({ error: 'TARGET', message: 'Hedef USER mentor olmalıdır.' });
    }
    const crossAllowed = await canCrossTenantMatch({
      requesterTenantId: req.tenant.tenantId,
      targetTenantId: target.tenantId,
    });
    if (!crossAllowed) {
      return res.status(403).json({
        error: 'SHARED_POOL_KAPALI',
        message: 'Bu mentorun tenant havuzu kapalı olduğu için talep gönderilemez.',
      });
    }
    // KR-19b: idari blok eşleşme isteğini de durdurur (önceden yalnız startConversation
    // kontrol ediyordu — K5-Y2 denetimi). startConversation ile AYNI kural: iki tarafın
    // tenant'ı, yön bağımsız. Varlık ifşası yok: jenerik 403, blok bilgisi sızdırılmaz.
    if (await isPairBlockedInTenants([req.tenant.tenantId, target.tenantId], requester.id, target.id)) {
      return res.status(403).json({
        error: 'ISLEM_YAPILAMIYOR',
        message: 'Bu işlem şu anda gerçekleştirilemiyor.',
      });
    }
  }

  const created = await prisma.matchRequest.create({
    data: {
      tenantId: req.tenant.tenantId,
      requesterUserId: requester.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      requestMessage: parsed.data.requestMessage,
    },
  });

  // Mentora anlık bildirim gönder
  if (parsed.data.targetType === 'USER') {
    void notifyMatchRequestReceived(parsed.data.targetId, req.tenant.tenantId);
  }

  return res.status(201).json(created);
}

const ListRequestsQuerySchema = z.object({
  requesterUserId: z.string().optional(),
  targetType: z.enum(['USER', 'JOB_LISTING']).optional(),
});

export async function listRequests(req: RequestWithTenant, res: Response) {
  const parsed = validateRequest(ListRequestsQuerySchema, req.query, res);
  if (!parsed.success) return parsed.response;

  // Yetki (Y1/3b-2): admin dışı kullanıcı YALNIZ taraf olduğu talepleri görür — gönderen
  // (requesterUserId) VEYA hedef mentör (targetType=USER, targetId). Aksi halde tüm tenant'ın
  // eşleşme talepleri + serbest-metin requestMessage (PII) peer'lere sızıyordu. ADMIN tenant
  // genelini görür (program yönetimi); istenirse requesterUserId query'siyle daraltır.
  const isAdmin = req.auth?.role === 'ADMIN';
  const meId = req.auth?.userId;

  const { limit, offset } = parsePagination(req.query['limit'], req.query['offset'], LIST_PAGE);
  const where = {
    tenantId: req.tenant.tenantId,
    ...(isAdmin
      ? (parsed.data.requesterUserId !== undefined && { requesterUserId: parsed.data.requesterUserId })
      : { OR: [{ requesterUserId: meId }, { targetType: 'USER' as const, targetId: meId }] }),
    ...(parsed.data.targetType !== undefined && { targetType: parsed.data.targetType }),
  };
  const [items, total] = await Promise.all([
    prisma.matchRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    }),
    prisma.matchRequest.count({ where }),
  ]);

  return res.json({ items, total, limit, offset });
}

export async function getRequest(req: RequestWithTenant, res: Response) {
  const request = await prisma.matchRequest.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
  });

  if (!request) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'İstek bulunamadı.' });
  }

  // IDOR koruması: bir eşleşme talebini yalnızca tarafları görebilir — talebi oluşturan
  // menti (requesterUserId) veya hedef mentor (targetType=USER ise targetId) — ya da ADMIN.
  // Yetkisiz erişimde 404 döneriz (403 "bu ID var ama senin değil" bilgisini sızdırır;
  // requestMessage PII içerdiğinden varlık ifşası bile istenmez).
  const isAdmin = req.auth?.role === 'ADMIN';
  const isRequester = req.auth?.userId === request.requesterUserId;
  const isTarget = request.targetType === 'USER' && req.auth?.userId === request.targetId;
  if (!isAdmin && !isRequester && !isTarget) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'İstek bulunamadı.' });
  }

  return res.json(request);
}

