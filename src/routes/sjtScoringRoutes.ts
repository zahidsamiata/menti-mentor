import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  computeProfileHandler,
  rankMentorsHandler,
  feedbackHandler,
  certifyHandler,
  certQuestionsHandler,
  certRevealHandler,
  certTopicsListHandler,
  certTopicSetHandler,
} from '../controllers/sjtScoringController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// POST /api/scoring/compute-profile → kullanıcı kendi profilini veya ADMIN herhangi birini hesaplayabilir
router.post(
  '/compute-profile',
  requireAuth(),
  computeProfileHandler as unknown as RequestHandler,
);

// POST /api/scoring/rank-mentors → kimlik doğrulaması zorunlu
router.post(
  '/rank-mentors',
  requireAuth(),
  rankMentorsHandler as unknown as RequestHandler,
);

// POST /api/scoring/feedback → MENTOR veya MENTI geri bildirim verebilir
router.post(
  '/feedback',
  requireRole('MENTOR', 'MENTI'),
  feedbackHandler as unknown as RequestHandler,
);

// GET /api/scoring/certification/questions → öğrenme akışı senaryoları (yalnızca MENTOR)
router.get(
  '/certification/questions',
  requireRole('MENTOR'),
  certQuestionsHandler as unknown as RequestHandler,
);

// POST /api/scoring/certification/answer → seçim sonrası açıklama (öğrenme anı, yalnızca MENTOR)
router.post(
  '/certification/answer',
  requireRole('MENTOR'),
  certRevealHandler as unknown as RequestHandler,
);

// POST /api/scoring/certify → yalnızca MENTOR; kendi ilk-deneme sonucunu değerlendirir
router.post(
  '/certify',
  requireRole('MENTOR'),
  certifyHandler as unknown as RequestHandler,
);

// GET /api/scoring/certification/topics → kurumun konu aç/kapat listesi (ADMIN)
router.get(
  '/certification/topics',
  requireRole('ADMIN'),
  certTopicsListHandler as unknown as RequestHandler,
);

// PATCH /api/scoring/certification/topics → konu aç/kapat (ADMIN, kendi tenant'ı)
router.patch(
  '/certification/topics',
  requireRole('ADMIN'),
  certTopicSetHandler as unknown as RequestHandler,
);

export default router;
