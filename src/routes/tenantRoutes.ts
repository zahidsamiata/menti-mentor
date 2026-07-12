import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
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

router.get('/', listTenants);
router.post('/', createTenant);
router.get('/:id', getTenant);
router.patch('/:id', updateTenant);

export default router;
