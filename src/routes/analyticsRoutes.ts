import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireSelfOrAdmin } from '../middleware/authorize.js';
import { getAnalytics } from '../controllers/analyticsController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// GET /api/analytics/:userId → ham DISC vektöründen türetilmiş profil (PII) döner.
// IDOR/KVKK: yalnızca kendi analitiğini veya ADMIN görebilir — aksi hâlde tenant-içi bir
// kullanıcı başkasının :userId'siyle ham DISC türevli profilini çekebilirdi.
router.get('/:userId', requireAuth(), requireSelfOrAdmin('userId'), getAnalytics as unknown as RequestHandler);

export default router;
