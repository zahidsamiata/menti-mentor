import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { rankMentisForMentor } from '../services/matching.js';
import { generateIceBreaker } from '../services/iceBreaker.js';
import { canCrossTenantMatch } from '../services/tenantSharing.js';

const RankQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Mentor, sistemin ürettiği sıralı menti listesini görür.
export async function getRankedMentisForMentor(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;
  const parsed = RankQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const result = await rankMentisForMentor({
    mentorId,
    mentorTenantId: req.tenant.tenantId,
    limit: parsed.data.limit,
  });

  return res.json(result);
}

const OptInSchema = z.object({
  mentiId: z.string().min(5),
  status: z.enum(['APPROVED', 'REJECTED']).default('APPROVED'),
});

// Rule 2: Mentor, mentilere visibility opt-in verir.
// Rule 3: Opt-in sonrası ice-breaker üret (LLM sadece burada devreye girer).
export async function setVisibilityOptIn(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;
  const parsed = OptInSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const mentor = await prisma.user.findFirst({
    where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR', isActive: true },
    select: { id: true, fullName: true, sectorTags: true, discType: true, interactionStyle: true },
  });
  if (!mentor) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  }

  const menti = await prisma.user.findUnique({
    where: { id: parsed.data.mentiId },
    select: {
      id: true,
      fullName: true,
      tenantId: true,
      sectorTags: true,
      discType: true,
      skills: true,
      interactionStyle: true,
      expectationCategories: true,
    },
  });
  if (!menti) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Menti bulunamadı.' });
  }

  // Rule 1: Cross-tenant opt-in (dolayısıyla matching) sadece iki tenant shared pool açıksa.
  const crossAllowed = await canCrossTenantMatch({
    requesterTenantId: req.tenant.tenantId,
    targetTenantId: menti.tenantId,
  });
  if (!crossAllowed) {
    return res.status(403).json({
      error: 'SHARED_POOL_KAPALI',
      message:
        'Tenant havuzu paylaşımı kapalı olduğu için bu menti için visibility opt-in verilemez (cross-tenant).',
    });
  }

  // Tenant vocabulary — ice-breaker'ı NGO kültürüne göre kişiselleştirmek için
  const tenantRecord = await prisma.tenant.findUnique({
    where: { id: req.tenant.tenantId },
    select: { tenantVocabulary: true },
  });

  let iceBreaker: string | null = null;
  if (parsed.data.status === 'APPROVED') {
    const sharedTopics = Array.from(
      new Set(
        menti.sectorTags
          .filter((t) => mentor.sectorTags.map((x) => x.toLowerCase()).includes(t.toLowerCase()))
          .slice(0, 5),
      ),
    );
    iceBreaker = await generateIceBreaker({
      mentorName: mentor.fullName,
      mentiName: menti.fullName,
      sharedTopics,
      mentiExpectations: menti.expectationCategories as string[],
      mentiSkills: menti.skills.slice(0, 3),
      mentorDiscType: mentor.discType,
      mentiDiscType: menti.discType,
      interactionStyleMatch: mentor.interactionStyle !== null && mentor.interactionStyle === menti.interactionStyle,
      tenantVocabulary: tenantRecord?.tenantVocabulary as any ?? null,
    });
  }

  const record = await prisma.visibilityOptIn.upsert({
    where: { mentorId_mentiId: { mentorId: mentor.id, mentiId: menti.id } },
    update: {
      status: parsed.data.status,
      iceBreaker: iceBreaker ?? undefined,
      tenantId: req.tenant.tenantId,
    },
    create: {
      tenantId: req.tenant.tenantId,
      mentorId: mentor.id,
      mentiId: menti.id,
      status: parsed.data.status,
      iceBreaker: iceBreaker ?? undefined,
    },
  });

  return res.json(record);
}
