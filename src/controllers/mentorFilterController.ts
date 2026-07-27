import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';

const UpsertFilterSchema = z.object({
  minCompatibilityScore: z.number().int().min(0).max(100).default(0),
  blockedDiscTypes: z.array(z.enum(['D', 'I', 'S', 'C'])).default([]),
  filterEnabled: z.boolean().default(true),
});

// GET /mentors/:mentorId/filter
export async function getMentorFilter(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;

  // Tenant izolasyonu (IDOR önleme): yalnızca istek yapılan tenant'a ait bir mentörün
  // filtresi okunabilir. Aksi halde başka kurumun mentör tercihleri sızardı.
  // (upsertMentorFilter ile aynı kontrol — iki uçta da tutarlı.)
  const mentor = await prisma.user.findFirst({
    where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR' },
    select: { id: true },
  });
  if (!mentor) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  }

  const filter = await prisma.mentorFilter.findUnique({ where: { mentorId } });

  return res.json(
    filter ?? {
      mentorId,
      minCompatibilityScore: 0,
      blockedDiscTypes: [],
      filterEnabled: true,
    },
  );
}

// PUT /mentors/:mentorId/filter
export async function upsertMentorFilter(req: RequestWithTenant, res: Response) {
  const mentorId = req.params['mentorId'] as string;

  const mentor = await prisma.user.findFirst({
    where: { id: mentorId, tenantId: req.tenant.tenantId, role: 'MENTOR' },
    select: { id: true },
  });
  if (!mentor) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Mentor bulunamadı.' });
  }

  const parsed = UpsertFilterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const filter = await prisma.mentorFilter.upsert({
    where: { mentorId },
    create: { mentorId, ...parsed.data },
    update: parsed.data,
  });

  return res.json(filter);
}
