import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';
import { buildFullAnalytics } from '../services/analyticsEngine.js';
import type { DiscVector } from '../services/scoring.js';

export async function getAnalytics(req: RequestWithTenant, res: Response) {
  const userId = req.params['userId'] as string;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId: req.tenant.tenantId },
    select: { id: true, discVector: true, discType: true },
  });

  if (!user) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Kullanıcı bulunamadı.' });
  }

  // discVector yoksa fallback: discType'dan düz vektör üret
  let vec: DiscVector;
  if (user.discVector) {
    vec = user.discVector as DiscVector;
  } else if (user.discType) {
    const base: Record<string, number> = { D: 0.1, I: 0.1, S: 0.1, C: 0.1 };
    base[user.discType] = 0.7;
    vec = { D: base['D'], I: base['I'], S: base['S'], C: base['C'], confidence: 0.3 };
  } else {
    return res.status(422).json({
      error: 'NO_DISC_DATA',
      message: 'Analitik profil için en az bir DISC değeri gereklidir. Lütfen soru bankasını tamamlayın.',
    });
  }

  const profile = buildFullAnalytics(user.id, vec);
  return res.json(profile);
}

