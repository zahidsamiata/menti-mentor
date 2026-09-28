import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { quarantined } from '../middleware/quarantine.js';
import { listSystemLogs } from '../controllers/systemLogController.js';

const router = Router();

// Sistem logları tenant-bağımsız platform verisidir — yalnızca platform yöneticisi erişebilir.
// Tenant kullanıcıları (ADMIN dahil) cross-tenant log sızıntısını önlemek için reddedilir.
router.use(requirePlatformAdmin);

// GET /api/system-logs
// E-4 KARANTİNA (KARAR-11 A): ikame `GET /api/platform/logs` (ön yüz bunu kullanıyor).
// Arşiv: çatı `docs/arsiv/silinenler-2026-09-10.md` § system-logs.
router.get('/', quarantined('system-logs'), listSystemLogs);

export default router;
