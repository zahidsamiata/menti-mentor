/**
 * Mentörlük Anlaşması Controller
 *
 * Eşleşme sonrası iki tarafın birlikte doldurduğu dijital anlaşma.
 * İki taraf onaylamadan ACTIVE olmaz; ACTIVE olmadan sisteme görünmez.
 *
 * Endpoint haritası:
 *   POST   /api/agreements              → createAgreement   (MENTOR | MENTI)
 *   POST   /api/agreements/:id/confirm  → confirmAgreement  (MENTOR | MENTI — kendi tarafını onaylar)
 *   GET    /api/agreements/active       → getActiveAgreement (self)
 *   POST   /api/agreements/:id/renew   → renewAgreement    (MENTOR | MENTI)
 *   POST   /api/agreements/:id/end     → endAgreement      (MENTOR | MENTI)
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { logger } from '../services/logger.js';

const CreateAgreementSchema = z.object({
  mentorId: z.string().min(1),
  mentiId:  z.string().min(1),
  matchId:  z.string().optional(),

  meetingFrequency:     z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  communicationChannel: z.enum(['ONLINE', 'IN_PERSON', 'PHONE']),
  durationWeeks:        z.number().int().min(1).max(52),
  targetMeetings:       z.number().int().min(1).max(100),
  mentiGoal:            z.string().min(10).max(1000),
  agendaOwner:          z.enum(['MENTOR', 'MENTI']).default('MENTI'),
  privacyAgreed:        z.literal(true),
});

export async function createAgreement(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const parsed = CreateAgreementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const d = parsed.data;
  const tenantId = req.tenant.tenantId;

  // Her iki kullanıcı da bu tenant'a üye olmalı
  const [mentor, menti] = await Promise.all([
    prisma.user.findFirst({ where: { id: d.mentorId, tenantId, isActive: true }, select: { id: true, role: true } }),
    prisma.user.findFirst({ where: { id: d.mentiId,  tenantId, isActive: true }, select: { id: true, role: true } }),
  ]);
  if (!mentor || mentor.role !== 'MENTOR') return res.status(404).json({ error: 'MENTOR_BULUNAMADI' });
  if (!menti  || menti.role  !== 'MENTI')  return res.status(404).json({ error: 'MENTI_BULUNAMADI' });

  // Zaten aktif anlaşma var mı?
  const existing = await prisma.mentorshipAgreement.findFirst({
    where: { tenantId, mentorId: d.mentorId, mentiId: d.mentiId, status: { in: ['DRAFT', 'ACTIVE', 'RENEWAL_PENDING'] } },
    select: { id: true, status: true },
  });
  if (existing) {
    return res.status(409).json({ error: 'ANLAŞMA_MEVCUT', message: 'Bu çift için zaten aktif bir anlaşma var.', existing });
  }

  const expiresAt = new Date(Date.now() + d.durationWeeks * 7 * 24 * 60 * 60 * 1000);

  const agreement = await prisma.mentorshipAgreement.create({
    data: {
      tenantId,
      mentorId: d.mentorId,
      mentiId:  d.mentiId,
      matchId:  d.matchId,
      meetingFrequency:     d.meetingFrequency,
      communicationChannel: d.communicationChannel,
      durationWeeks:        d.durationWeeks,
      targetMeetings:       d.targetMeetings,
      mentiGoal:            d.mentiGoal,
      agendaOwner:          d.agendaOwner,
      privacyAgreed:        true,
      expiresAt,
    },
  });

  void logger.info('SYSTEM', 'Mentörlük anlaşması oluşturuldu', { agreementId: agreement.id, tenantId });
  return res.status(201).json(agreement);
}

export async function confirmAgreement(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const agreementId = req.params['id'] as string;
  const userId = req.auth.userId;

  const agreement = await prisma.mentorshipAgreement.findFirst({
    where: { id: agreementId, tenantId: req.tenant.tenantId },
  });
  if (!agreement) return res.status(404).json({ error: 'NOT_FOUND' });
  if (agreement.status !== 'DRAFT') {
    return res.status(409).json({ error: 'DURUM_HATASI', message: 'Yalnızca TASLAK anlaşmalar onaylanabilir.' });
  }

  const isMentor = agreement.mentorId === userId;
  const isMenti  = agreement.mentiId  === userId;
  if (!isMentor && !isMenti) return res.status(403).json({ error: 'YETKI_YETERSIZ' });

  const data: Record<string, Date | string> = {};
  if (isMentor && !agreement.mentorConfirmedAt) data['mentorConfirmedAt'] = new Date();
  if (isMenti  && !agreement.mentiConfirmedAt)  data['mentiConfirmedAt']  = new Date();

  // İki taraf da onayladıysa ACTIVE yap
  const mentorConfirmed = isMentor ? new Date() : agreement.mentorConfirmedAt;
  const mentiConfirmed  = isMenti  ? new Date() : agreement.mentiConfirmedAt;
  if (mentorConfirmed && mentiConfirmed) data['status'] = 'ACTIVE';

  const updated = await prisma.mentorshipAgreement.update({
    where: { id: agreementId },
    data,
  });

  void logger.info('SYSTEM', 'Anlaşma onaylandı', { agreementId, userId, newStatus: updated.status });
  return res.json(updated);
}

export async function getActiveAgreement(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const userId   = req.auth.userId;
  const tenantId = req.tenant.tenantId;

  const agreement = await prisma.mentorshipAgreement.findFirst({
    where: {
      tenantId,
      status: { in: ['DRAFT', 'ACTIVE', 'RENEWAL_PENDING'] },
      OR: [{ mentorId: userId }, { mentiId: userId }],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!agreement) return res.status(404).json({ error: 'NOT_FOUND', message: 'Aktif anlaşma bulunamadı.' });
  return res.json(agreement);
}

export async function renewAgreement(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const agreementId = req.params['id'] as string;
  const userId      = req.auth.userId;

  const agreement = await prisma.mentorshipAgreement.findFirst({
    where: { id: agreementId, tenantId: req.tenant.tenantId },
  });
  if (!agreement) return res.status(404).json({ error: 'NOT_FOUND' });
  if (agreement.status !== 'RENEWAL_PENDING') {
    return res.status(409).json({ error: 'DURUM_HATASI', message: 'Yalnızca yenileme bekleyen anlaşmalar yenilenebilir.' });
  }
  if (agreement.mentorId !== userId && agreement.mentiId !== userId) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const newExpiresAt = new Date(Date.now() + agreement.durationWeeks * 7 * 24 * 60 * 60 * 1000);
  const updated = await prisma.mentorshipAgreement.update({
    where: { id: agreementId },
    data: { status: 'RENEWED', expiresAt: newExpiresAt, renewalAskedAt: null },
  });

  void logger.info('SYSTEM', 'Anlaşma yenilendi', { agreementId, userId });
  return res.json(updated);
}

export async function endAgreement(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });

  const agreementId = req.params['id'] as string;
  const userId      = req.auth.userId;

  const agreement = await prisma.mentorshipAgreement.findFirst({
    where: { id: agreementId, tenantId: req.tenant.tenantId },
  });
  if (!agreement) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!['ACTIVE', 'RENEWAL_PENDING'].includes(agreement.status)) {
    return res.status(409).json({ error: 'DURUM_HATASI', message: 'Yalnızca aktif anlaşmalar bitirilebilir.' });
  }
  if (agreement.mentorId !== userId && agreement.mentiId !== userId) {
    return res.status(403).json({ error: 'YETKI_YETERSIZ' });
  }

  const updated = await prisma.mentorshipAgreement.update({
    where: { id: agreementId },
    data: { status: 'ENDED' },
  });

  void logger.info('SYSTEM', 'Anlaşma onurlu bitiş', { agreementId, userId });
  return res.json(updated);
}
