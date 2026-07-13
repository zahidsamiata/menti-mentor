import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { analyzeTemperament } from '../services/temperamentAnalysis.js';

const QuestionAnswerSchema = z.object({
  questionId: z.number().int().min(1).max(7),
  selectedDisc: z.enum(['D', 'I', 'S', 'C']),
  selectedEnneagram: z.string().optional(),
});

const TemperamentTestBodySchema = z.object({
  answers: z
    .array(QuestionAnswerSchema)
    .length(7, 'Exactly 7 answers are required.')
    .refine(
      (answers) => {
        const ids = answers.map((a) => a.questionId);
        return new Set(ids).size === 7;
      },
      { message: 'Each questionId (1-7) must appear exactly once.' },
    ),
});

// POST /api/users/:id/temperament-test
export async function submitTemperamentTest(req: RequestWithTenant, res: Response) {
  const parsed = TemperamentTestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const userId  = req.params['id'] as string;
  const isAdmin = req.auth?.role === 'ADMIN';
  const isSelf  = req.auth?.userId === userId;

  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'YETKISIZ', message: 'Yalnızca kendi testinizi gönderebilirsiniz.' });
  }

  const existing = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  const result = analyzeTemperament(parsed.data.answers);

  const updatedUser = await prisma.user.update({
    where: { id: existing.id },
    data: {
      discType: result.dominantDisc,
      temperamentJson: result,
      enneagramWing: result.enneagramWing,
    },
  });

  return res.json({ user: updatedUser, analysis: result });
}
