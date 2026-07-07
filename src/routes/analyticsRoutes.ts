import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth } from '../middleware/authorize.js';
import { getAnalytics } from '../controllers/analyticsController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// GET /api/analytics/:userId → kimlik doğrulaması zorunlu (DISC vektörü PII içerir)
router.get('/:userId', requireAuth(), getAnalytics as unknown as RequestHandler);

export default router;
