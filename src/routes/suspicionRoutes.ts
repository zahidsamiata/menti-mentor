import { Router } from 'express';
import { createSuspicionReport } from '../controllers/suspicionController.js';
import { suspicionReportRateLimiter } from '../middleware/rateLimiter.js';
import { requireTurnstile } from '../middleware/turnstile.js';

const router = Router();

// Public: sahte kurum/davet şüphesi bildirimi
// suspicionReportRateLimiter: IP-bazlı — spam/kötüye-kullanım bildirimi koruması.
// requireTurnstile: F-05/G1-26 — CAPTCHA anahtarı yoksa no-op (bkz. middleware/turnstile.ts).
router.post('/', suspicionReportRateLimiter, requireTurnstile, createSuspicionReport);

export default router;
