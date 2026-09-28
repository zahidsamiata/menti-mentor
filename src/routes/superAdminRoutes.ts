import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { quarantined } from '../middleware/quarantine.js';
import {
  getSuperAdminDashboard,
  updateTenantStatus,
  listPendingTenants,
  verifyTenant,
} from '../controllers/adminSettingsController.js';

const router = Router();

router.use(requirePlatformAdmin);

router.get('/dashboard', getSuperAdminDashboard);
// E-4 KARANTİNA (KARAR-11 A): ikame `POST /api/platform/tenants/:id/freeze` + `/activate` (denetim izli).
// Arşiv: çatı `docs/arsiv/silinenler-2026-09-10.md` § super-admin-tenant-status.
router.patch('/tenants/:id/status', quarantined('super-admin-tenant-status'), updateTenantStatus);

// Kurum kayıt doğrulama
// E-4 KARANTİNA (KARAR-11 A): ikame `GET /api/platform/tenants/pending` (aynı maske + iz).
router.get('/tenants/pending', quarantined('super-admin-tenants-pending'), listPendingTenants);
router.patch('/tenants/:id/verify', verifyTenant);

export default router;
