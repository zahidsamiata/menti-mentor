/**
 * Öğrenme Yolculuğu Controller — HTTP katmanı.
 *
 * Sorumluluk: istek doğrulama + yanıt biçimlendirme.
 * İş mantığı: learningJourney.service.ts'e delege edilir.
 *
 * KEŞİF akışı — puanlama YOK. Endpoint haritası (oyuncu):
 *   GET  /api/learning-journey/stages          → getStages       (audience = rol)
 *   POST /api/learning-journey/stages/:id/select → selectChoice  (outcome + feedback)
 *   POST /api/learning-journey/complete          → completeJourney (tamamlandı işaretle)
 *   GET  /api/learning-journey/status            → getStatus
 */

import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import {
  audienceForRole,
  buildStageList,
  resolveChoice,
  markJourneyCompleted,
  getJourneyStatus,
  LEARNING_JOURNEY_FRAME,
} from '../services/learningJourney.service.js';

const SelectChoiceSchema = z.object({
  choiceKey: z.string().min(1).max(8),
});

// ─── GET /api/learning-journey/stages ─────────────────────────────────────────

/** Kullanıcının rolüne karşılık gelen yolculuğun aşamalarını döner. */
export async function getStages(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });

  const audience = audienceForRole(req.auth.role);
  if (!audience) {
    return res.status(403).json({
      error: 'YOLCULUK_YOK',
      message: 'Bu rol için öğrenme yolculuğu bulunmuyor.',
    });
  }

  const stages = await buildStageList(req.tenant.tenantId, audience);
  const frame = LEARNING_JOURNEY_FRAME[audience];
  return res.json({ audience, frame, items: stages, total: stages.length });
}

// ─── POST /api/learning-journey/stages/:stageId/select ───────────────────────

/** Bir seçimin outcome + feedback'ini döner. PUAN YOK, geçme-kalma YOK. */
export async function selectChoice(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });

  const audience = audienceForRole(req.auth.role);
  if (!audience) {
    return res.status(403).json({ error: 'YOLCULUK_YOK', message: 'Bu rol için öğrenme yolculuğu bulunmuyor.' });
  }

  const stageId = req.params['stageId'] as string;
  const parsed = SelectChoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const result = await resolveChoice(req.tenant.tenantId, audience, stageId, parsed.data.choiceKey);
  if (!result) {
    return res.status(404).json({
      error: 'SECIM_BULUNAMADI',
      message: 'Aşama veya seçenek bulunamadı ya da erişim reddedildi.',
    });
  }

  return res.json(result);
}

// ─── POST /api/learning-journey/complete ─────────────────────────────────────

/** Yolculuğu tamamlandı olarak işaretler (idempotent). */
export async function completeJourney(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });

  const audience = audienceForRole(req.auth.role);
  if (!audience) {
    return res.status(403).json({ error: 'YOLCULUK_YOK', message: 'Bu rol için öğrenme yolculuğu bulunmuyor.' });
  }

  // IDOR koruması: yalnızca kimliği doğrulanmış kullanıcının kendi üyeliği.
  const { completedAt } = await markJourneyCompleted(req.auth.userId, req.tenant.tenantId);
  return res.json({ message: 'Öğrenme yolculuğu tamamlandı.', completed: true, completedAt });
}

// ─── GET /api/learning-journey/status ────────────────────────────────────────

/** Kullanıcının yolculuk durumunu döner. */
export async function getStatus(req: RequestWithTenant, res: Response) {
  if (!req.auth) return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI', message: 'Giriş gerekli.' });

  const audience = audienceForRole(req.auth.role);
  if (!audience) {
    return res.status(403).json({ error: 'YOLCULUK_YOK', message: 'Bu rol için öğrenme yolculuğu bulunmuyor.' });
  }

  const status = await getJourneyStatus(req.auth.userId, req.tenant.tenantId, audience);
  return res.json(status);
}
