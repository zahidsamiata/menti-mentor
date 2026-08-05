import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import {
  getKpiDashboard,
  adminListUsers,
  adminListMatches,
  adminListCertResults,
  triggerRematch,
  confirmDoubleOptIn,
  manualRunTuning,
  manualRunPurge,
  approveUser,
  rejectUser,
  requestCorrection,
  getCoachingSuggestions,
  getPendingTuning,
  approvePendingTuning,
  rejectPendingTuning,
  listAdmins,
  promoteToAdmin,
  demoteFromAdmin,
  getHealthMetrics,
  nudgeUser,
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
// "Kimse kaynıyor mu" — mentörsüz menti / ölü eşleşme / pasif üye + arz-talep dengesi (drill-down)
router.get('/health-metrics', getHealthMetrics as unknown as RequestHandler);

// ─── Kullanıcı Yönetimi ───────────────────────────────────────────────────────
router.get('/users', adminListUsers as unknown as RequestHandler);

// ─── Eşleşme + Sertifika panelleri (A1, A4) ───────────────────────────────────
router.get('/matches', adminListMatches as unknown as RequestHandler);
router.get('/mentors/certification-results', adminListCertResults as unknown as RequestHandler);
router.post('/users/:id/approve', approveUser as unknown as RequestHandler);
router.post('/users/:id/reject', rejectUser as unknown as RequestHandler);
router.post('/users/:id/request-correction', requestCorrection as unknown as RequestHandler);
router.post('/users/:id/rematch', triggerRematch as unknown as RequestHandler);
// Yönetici elle dürtme (pasif üye / ölü eşleşme re-engagement) — spam-limitli, loglu
router.post('/users/:id/nudge', nudgeUser as unknown as RequestHandler);
// GET /api/admin/users/:id/coaching-suggestions — kural bazlı aksiyon önerileri
router.get('/users/:id/coaching-suggestions', getCoachingSuggestions as unknown as RequestHandler);

// ─── Taxonomy (Etiket Yönetimi) ───────────────────────────────────────────────
router.get('/tags/pending', listPendingTags as unknown as RequestHandler);
router.post('/tags/:id/approve', approveTag as unknown as RequestHandler);
router.post('/tags/:id/merge', mergeTag as unknown as RequestHandler);
router.post('/tags/:id/reject', rejectTag as unknown as RequestHandler);

// ─── Double Opt-In ────────────────────────────────────────────────────────────
router.post('/visibility-optin/:optInId/confirm', confirmDoubleOptIn as unknown as RequestHandler);

// ─── AlgorithmTuner Onay Kapısı ──────────────────────────────────────────────
router.get( '/algorithm-tuner/pending', getPendingTuning     as unknown as RequestHandler);
router.post('/algorithm-tuner/approve', approvePendingTuning as unknown as RequestHandler);
router.post('/algorithm-tuner/reject',  rejectPendingTuning  as unknown as RequestHandler);

// ─── Cron Manuel Tetikleme ────────────────────────────────────────────────────
router.post('/cron/run-tuning', manualRunTuning as unknown as RequestHandler);
router.post('/cron/run-purge', manualRunPurge as unknown as RequestHandler);

// ─── Çoklu Admin Yönetimi ─────────────────────────────────────────────────────
router.get('/managers', listAdmins as unknown as RequestHandler);
router.post('/users/:id/promote-admin', promoteToAdmin as unknown as RequestHandler);
router.post('/users/:id/demote-admin', demoteFromAdmin as unknown as RequestHandler);

export default router;
