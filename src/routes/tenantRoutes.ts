import { Router } from 'express';
import {
  createTenant,
  listTenants,
  getTenant,
  updateTenant,
} from '../controllers/tenantController.js';

const router = Router();

// Global tenant yönetimi (X-Tenant-Id gerektirmez)
router.get('/', listTenants);
router.post('/', createTenant);
router.get('/:id', getTenant);
router.patch('/:id', updateTenant);

export default router;
