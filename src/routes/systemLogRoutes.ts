import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { listSystemLogs } from '../controllers/systemLogController.js';

const router = Router();

// Tüm sistem log endpoint'leri tenant doğrulaması gerektirir
router.use(requireTenant as RequestHandler);

// GET /api/system-logs
router.get('/', listSystemLogs as unknown as RequestHandler);

export default router;
