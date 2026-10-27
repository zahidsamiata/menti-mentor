import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { quarantined } from '../middleware/quarantine.js';
import {
  createTenant,
  listTenants,
  getTenant,
  updateTenant,
} from '../controllers/tenantController.js';

const router = Router();

// Tenant CRUD yalnızca platform yöneticisine açıktır.
// Self-serve akış için ayrı endpoint: POST /api/tenants/self-serve/register
router.use(requirePlatformAdmin);

// E-4 KARANTİNA (KARAR-11 A): ikame `GET /api/platform/tenants` (sayfalı, denetim izli).
// Arşiv: çatı `docs/arsiv/silinenler-2026-09-10.md` § tenants-list / tenants-get.
router.get('/', quarantined('tenants-list'), listTenants);
router.post('/', createTenant);
// E-4 KARANTİNA (KARAR-11 A): ikame `GET /api/platform/tenants/:id/overview` (maskeli, denetim izli).
router.get('/:id', quarantined('tenants-get'), getTenant);
router.patch('/:id', updateTenant);

export default router;
