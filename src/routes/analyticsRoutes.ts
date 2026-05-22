import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { getAnalytics } from '../controllers/analyticsController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// GET /api/analytics/:userId → tenant içindeki herkes
router.get('/:userId', getAnalytics as unknown as RequestHandler);

export default router;
