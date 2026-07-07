import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  computeProfileHandler,
  rankMentorsHandler,
  feedbackHandler,
  certifyHandler,
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

// POST /api/scoring/certify → yalnızca MENTOR rolü sertifika sınavına girebilir
router.post(
  '/certify',
  requireRole('MENTOR'),
  certifyHandler as unknown as RequestHandler,
);

export default router;
