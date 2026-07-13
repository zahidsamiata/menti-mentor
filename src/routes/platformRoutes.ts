import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import {
  platformLogin,
  getPlatformStats,
  getPlatformHealth,
  getPlatformLogs,
  listPendingTenants,
  listAllTenants,
  approveTenant,
  rejectTenant,
  freezeTenant,
  activateTenant,
  listSuspicionReports,
  reviewSuspicionReport,
} from '../controllers/platformController.js';

const router = Router();

// Public: e-posta + şifre ile platform auth
router.post('/auth', platformLogin);

// Protected: platform-admin token tüm aşağıdaki endpoint'ler için zorunlu
router.use(requirePlatformAdmin);

// ─── Genel ───────────────────────────────────────────────────────────────────
router.get('/stats', getPlatformStats);
router.get('/health', getPlatformHealth);
router.get('/logs', getPlatformLogs);

// ─── Kurum Yönetimi ───────────────────────────────────────────────────────────
router.get('/tenants/pending', listPendingTenants);
router.get('/tenants', listAllTenants);
router.post('/tenants/:id/approve', approveTenant);
router.post('/tenants/:id/reject', rejectTenant);
router.post('/tenants/:id/freeze', freezeTenant);
router.post('/tenants/:id/activate', activateTenant);

// ─── Şüphe Bildirimleri ───────────────────────────────────────────────────────
router.get('/suspicion-reports', listSuspicionReports);
router.post('/suspicion-reports/:id/review', reviewSuspicionReport);

export default router;
