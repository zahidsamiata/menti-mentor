import { Router } from 'express';
import { createSuspicionReport } from '../controllers/suspicionController.js';
import { suspicionReportRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Public: sahte kurum/davet şüphesi bildirimi
// suspicionReportRateLimiter: IP-bazlı — spam/kötüye-kullanım bildirimi koruması.
router.post('/', suspicionReportRateLimiter, createSuspicionReport);

export default router;
