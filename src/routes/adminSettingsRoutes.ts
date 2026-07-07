import { Router, type RequestHandler } from 'express';
import {
  updateTenantSettings,
  blockPair,
} from '../controllers/adminSettingsController.js';

const router = Router();

// X-Tenant-Id gerektirmez — JWT Bearer + tenantId URL param eşleşmesiyle korunur.
// selfServeRoutes'taki pattern ile tutarlı.

// PATCH /api/tenants/:id/settings
// Dernek yöneticisi haftalık görüşme limiti ve minimum eşleşme skorunu günceller.
router.patch('/:id/settings',   updateTenantSettings as RequestHandler);

// POST /api/tenants/:id/block-pair
// Kurumsal huzur için admin iki üyeyi birbirleriyle eşleşmeye kapatır.
router.post('/:id/block-pair',  blockPair            as RequestHandler);

export default router;
