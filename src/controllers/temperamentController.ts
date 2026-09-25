import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { analyzeTemperament } from '../services/temperamentAnalysis.js';
import { validateRequest } from '../middleware/validate.js';

const QuestionAnswerSchema = z.object({
  questionId: z.number().int().min(1).max(7),
  selectedDisc: z.enum(['D', 'I', 'S', 'C']),
  selectedEnneagram: z.string().optional(),
});

const TemperamentTestBodySchema = z.object({
  answers: z
    .array(QuestionAnswerSchema)
    .length(7, 'Mizaç testinde 7 sorunun hepsi yanıtlanmalı.')
    .refine(
      (answers) => {
        const ids = answers.map((a) => a.questionId);
        return new Set(ids).size === 7;
      },
      { message: 'Her soru (1-7) yalnız bir kez yanıtlanmalı.' },
    ),
});

// POST /api/users/:id/temperament-test
export async function submitTemperamentTest(req: RequestWithTenant, res: Response) {
  const parsed = validateRequest(TemperamentTestBodySchema, req.body, res);
  if (!parsed.success) return parsed.response;

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

  // KVKK/over-fetch (madde 38): select'siz update ham User objesini (password hash +
  // discVector + selfProfile + e-posta + CV alanları) response'a taşırdı. `analysis`
  // zaten tam sonucu döndürdüğünden, yanıt yalnızca güncellenen kimlik+test alanlarına
  // daraltılır. password global omit + explicit select ile iki kat dışarıdadır.
  const updatedUser = await prisma.user.update({
    where: { id: existing.id },
    data: {
      discType: result.dominantDisc,
      temperamentJson: result,
      enneagramWing: result.enneagramWing,
    },
    select: {
      id: true,
      discType: true,
      temperamentJson: true,
      enneagramWing: true,
      updatedAt: true,
    },
  });

  return res.json({ user: updatedUser, analysis: result });
}
