import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth } from '../middleware/authorize.js';
import { getPending, respond } from '../controllers/surveyController.js';

const router = Router();
// requireTenant async olduğu için cast gerekli (feedbackLogRoutes ile aynı desen).
router.use(requireTenant as unknown as RequestHandler);
router.use(requireAuth());

// GET  /api/surveys/pending             → kimlik doğrulaması zorunlu
router.get('/pending', getPending as unknown as RequestHandler);

// POST /api/surveys/:questionKey/respond → kimlik doğrulaması zorunlu
router.post('/:questionKey/respond', respond as unknown as RequestHandler);

export default router;
