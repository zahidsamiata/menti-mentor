import express, { Router } from 'express';
import { receiveCspReport, swallowCspReportErrors } from '../controllers/cspReportController.js';
import { cspReportRateLimiter } from '../middleware/rateLimiter.js';
import { CSP_REPORT_BODY_LIMIT, CSP_REPORT_CONTENT_TYPES } from '../services/cspReport.js';

const router = Router();

// Public: tarayıcının CSP ihlal raporu (AJ-52) — kimlik doğrulama YOK (tarayıcı oturumsuz gönderir).
// Sıra: önce IP-bazlı oran sınırı (ucuz ret), sonra yalnız iki rapor içerik tipi için 8 KB sınırlı
// ayrıştırıcı. Genel `express.json` (server.ts) bu tipleri ayrıştırmaz; `application/json` gövdesi
// denetleyicide içerik tipi denetimine takılır ve yazılmaz.
router.post(
  '/',
  cspReportRateLimiter,
  express.json({ type: CSP_REPORT_CONTENT_TYPES, limit: CSP_REPORT_BODY_LIMIT }),
  receiveCspReport,
  swallowCspReportErrors,
);

export default router;
