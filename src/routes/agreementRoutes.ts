import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  createAgreement,
  confirmAgreement,
  getActiveAgreement,
  renewAgreement,
  endAgreement,
} from '../controllers/agreementController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// GET  /api/agreements/active  → kullanıcının aktif anlaşmasını getirir
router.get('/active', requireAuth(), getActiveAgreement as unknown as RequestHandler);

// POST /api/agreements         → anlaşma taslağı oluştur (MENTOR veya MENTI)
router.post('/', requireRole('ADMIN', 'MENTOR', 'MENTI'), createAgreement as unknown as RequestHandler);

// POST /api/agreements/:id/confirm → tarafın kendi onayını verir
router.post('/:id/confirm', requireAuth(), confirmAgreement as unknown as RequestHandler);

// POST /api/agreements/:id/renew  → yenileme onayı
router.post('/:id/renew', requireAuth(), renewAgreement as unknown as RequestHandler);

// POST /api/agreements/:id/end    → anlaşmayı onurlu bitir
router.post('/:id/end', requireAuth(), endAgreement as unknown as RequestHandler);

export default router;
