/**
 * Öğrenme Yolculuğu route'ları (oyuncu tarafı — menti/mentör).
 *
 * KEŞİF akışı — puanlama YOK. Admin (STK) CRUD route'ları ayrı dosyadadır
 * (learningJourneyAdminRoutes.ts): rol/yetki ayrımı net kalsın.
 *
 * Route sırası: sabit path'ler (/stages, /complete, /status) parametrik
 * /stages/:stageId/select'ten önce tanımlıdır (Express üstten-aşağı eşleştirir).
 */

import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import {
  getStages,
  selectChoice,
  completeJourney,
  getStatus,
} from '../controllers/learningJourneyController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// Yolculuk yalnızca MENTOR ve MENTI rolleri içindir (ADMIN oynamaz).
const PLAYER_ROLES = ['MENTOR', 'MENTI'] as const;

/** GET /api/learning-journey/stages — role göre yolculuk aşamaları + çerçeve metni */
router.get('/stages', requireRole(...PLAYER_ROLES), getStages as unknown as RequestHandler);

/** GET /api/learning-journey/status — tamamlanma durumu */
router.get('/status', requireRole(...PLAYER_ROLES), getStatus as unknown as RequestHandler);

/** POST /api/learning-journey/complete — yolculuğu tamamlandı işaretle */
router.post('/complete', requireRole(...PLAYER_ROLES), completeJourney as unknown as RequestHandler);

/** POST /api/learning-journey/stages/:stageId/select — seçim → outcome + feedback */
router.post(
  '/stages/:stageId/select',
  requireRole(...PLAYER_ROLES),
  selectChoice as unknown as RequestHandler,
);

export default router;
