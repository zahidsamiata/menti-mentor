import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import {
  createFeedbackLog,
  listFeedbackLogs,
  getFeedbackLog,
  getCombinationScores,
} from '../controllers/feedbackLogController.js';

const router = Router();
// requireTenant async olduğu için cast gerekli.
router.use(requireTenant as unknown as RequestHandler);

// ─── ML geri bildirim döngüsü ────────────────────────────────────────────────
// POST /                   → ADMIN veya MENTOR
router.post('/', requireRole('ADMIN', 'MENTOR'), createFeedbackLog as unknown as RequestHandler);

// GET  /                   → tenant içindeki herkes
router.get('/', listFeedbackLogs as unknown as RequestHandler);

// GET  /combination-scores → yalnızca ADMIN (ML skor analizi)
router.get(
  '/combination-scores',
  requireRole('ADMIN'),
  getCombinationScores as unknown as RequestHandler,
);

// GET  /:id                → tenant içindeki herkes
router.get('/:id', getFeedbackLog as unknown as RequestHandler);

export default router;
