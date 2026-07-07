import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';

const CreateRequestSchema = z.object({
  requesterUserId: z.string().min(5),
  targetType: z.enum(['USER', 'JOB_LISTING']),
  targetId: z.string().min(5),
  requestMessage: z.string().max(1000).optional(),
});

// Rule 2: Menti -> Mentor request sadece opt-in sonrası mümkün.
// Rule 4: Polymorphic target (USER veya JOB_LISTING).
export async function createMatchRequest(req: RequestWithTenant, res: Response) {
  const parsed = CreateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const requester = await prisma.user.findFirst({
    where: { id: parsed.data.requesterUserId, tenantId: req.tenant.tenantId, isActive: true },
    select: { id: true, role: true },
  });
  if (!requester) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requester kullanıcı bulunamadı.' });
  }

  if (parsed.data.targetType === 'USER') {
    // hedef mentor olmalı; menti bunu görebilmek için opt-in almış olmalı
    const target = await prisma.user.findUnique({
      where: { id: parsed.data.targetId },
      select: { id: true, role: true },
    });
    if (!target || target.role !== 'MENTOR') {
      return res.status(400).json({ error: 'TARGET', message: 'Hedef USER mentor olmalıdır.' });
    }

    const optIn = await prisma.visibilityOptIn.findUnique({
      where: { mentorId_mentiId: { mentorId: target.id, mentiId: requester.id } },
      select: { status: true },
    });
    if (!optIn || optIn.status !== 'APPROVED') {
      return res.status(403).json({
        error: 'VISIBILITY_OPTIN_GEREKLI',
        message: 'Bu mentor için visibility opt-in yok; istek gönderemezsiniz.',
      });
    }
  }

  // JOB_LISTING hedefi için şimdilik ek kural yok (ileride job match akışı gelecek)
  const created = await prisma.matchRequest.create({
    data: {
      tenantId: req.tenant.tenantId,
      requesterUserId: requester.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      requestMessage: parsed.data.requestMessage,
    },
  });

  return res.status(201).json(created);
}

const ListRequestsQuerySchema = z.object({
  requesterUserId: z.string().optional(),
  targetType: z.enum(['USER', 'JOB_LISTING']).optional(),
});

export async function listRequests(req: RequestWithTenant, res: Response) {
  const parsed = ListRequestsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const items = await prisma.matchRequest.findMany({
    where: {
      tenantId: req.tenant.tenantId,
      ...(parsed.data.requesterUserId !== undefined && {
        requesterUserId: parsed.data.requesterUserId,
      }),
      ...(parsed.data.targetType !== undefined && { targetType: parsed.data.targetType }),
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ items, total: items.length });
}

export async function getRequest(req: RequestWithTenant, res: Response) {
  const request = await prisma.matchRequest.findFirst({
    where: { id: req.params['id'] as string, tenantId: req.tenant.tenantId },
  });

  if (!request) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'İstek bulunamadı.' });
  }

  return res.json(request);
}

