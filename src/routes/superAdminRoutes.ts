import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import {
  getSuperAdminDashboard,
  updateTenantStatus,
  listPendingTenants,
  verifyTenant,
} from '../controllers/adminSettingsController.js';

const router = Router();

router.use(requirePlatformAdmin);

router.get('/dashboard', getSuperAdminDashboard);
router.patch('/tenants/:id/status', updateTenantStatus);

// Kurum kayıt doğrulama
router.get('/tenants/pending', listPendingTenants);
router.patch('/tenants/:id/verify', verifyTenant);

export default router;
