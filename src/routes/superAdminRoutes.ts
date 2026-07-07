import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import {
  getSuperAdminDashboard,
  updateTenantStatus,
} from '../controllers/adminSettingsController.js';

const router = Router();

// Tüm super-admin endpoint'leri platform admin token'ı gerektirir.
// Token: POST /api/platform/auth → { accessToken } → isPlatformAdmin: true
router.use(requirePlatformAdmin);

// GET /api/super-admin/dashboard
// Tüm platformun çatı görünümü: tenant sayısı, aktif kullanıcı, toplam mentörlük saati.
router.get('/dashboard', getSuperAdminDashboard);

// PATCH /api/super-admin/tenants/:id/status
// Bir derneği askıya alma veya aktif etme.
router.patch('/tenants/:id/status', updateTenantStatus);

export default router;
