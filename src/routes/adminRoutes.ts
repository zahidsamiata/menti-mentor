import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import {
  getKpiDashboard,
  adminListUsers,
  triggerRematch,
  confirmDoubleOptIn,
  manualRunTuning,
  manualRunPurge,
  approveUser,
  rejectUser,
  requestCorrection,
} from '../controllers/adminController.js';
import {
  listPendingTags,
  approveTag,
  mergeTag,
  rejectTag,
} from '../controllers/tagController.js';

const router = Router();

// Tüm admin endpoint'leri: tenant izolasyonu + ADMIN rolü zorunlu
router.use(requireTenant as unknown as RequestHandler);
router.use(requireRole('ADMIN'));

// ─── KPI & Raporlama ──────────────────────────────────────────────────────────
router.get('/kpi', getKpiDashboard as unknown as RequestHandler);

// ─── Kullanıcı Yönetimi ───────────────────────────────────────────────────────
router.get('/users', adminListUsers as unknown as RequestHandler);
router.post('/users/:id/approve', approveUser as unknown as RequestHandler);
router.post('/users/:id/reject', rejectUser as unknown as RequestHandler);
router.post('/users/:id/request-correction', requestCorrection as unknown as RequestHandler);
router.post('/users/:id/rematch', triggerRematch as unknown as RequestHandler);

// ─── Taxonomy (Etiket Yönetimi) ───────────────────────────────────────────────
router.get('/tags/pending', listPendingTags as unknown as RequestHandler);
router.post('/tags/:id/approve', approveTag as unknown as RequestHandler);
router.post('/tags/:id/merge', mergeTag as unknown as RequestHandler);
router.post('/tags/:id/reject', rejectTag as unknown as RequestHandler);

// ─── Double Opt-In ────────────────────────────────────────────────────────────
router.post('/visibility-optin/:optInId/confirm', confirmDoubleOptIn as unknown as RequestHandler);

// ─── Cron Manuel Tetikleme ────────────────────────────────────────────────────
router.post('/cron/run-tuning', manualRunTuning as unknown as RequestHandler);
router.post('/cron/run-purge', manualRunPurge as unknown as RequestHandler);

export default router;
