import { Router, type RequestHandler } from 'express';
import {
  updateTenantSettings,
  blockPair,
  listBlockedPairs,
  unblockPair,
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

// GET /api/tenants/:id/block-pairs
// E-3d: admin panelinde koyduğu engelleri görür (liste).
router.get('/:id/block-pairs',           listBlockedPairs as RequestHandler);

// DELETE /api/tenants/:id/block-pair/:pairId
// E-3d: engeli kaldırır — çift yeniden eşleşme/mesaj/randevu/anlaşma kurabilir.
router.delete('/:id/block-pair/:pairId', unblockPair      as RequestHandler);

export default router;
