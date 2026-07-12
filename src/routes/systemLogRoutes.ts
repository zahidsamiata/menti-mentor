import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { listSystemLogs } from '../controllers/systemLogController.js';

const router = Router();

// Sistem logları tenant-bağımsız platform verisidir — yalnızca platform yöneticisi erişebilir.
// Tenant kullanıcıları (ADMIN dahil) cross-tenant log sızıntısını önlemek için reddedilir.
router.use(requirePlatformAdmin);

// GET /api/system-logs
router.get('/', listSystemLogs);

export default router;
