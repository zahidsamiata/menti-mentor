/**
 * Öğrenme Yolculuğu — Yönetici (STK) CRUD route'ları.
 * Taban path: /api/admin/learning-journey
 *
 * Tümü requireRole('ADMIN') + tenant izolasyonu. Global aşama mutasyonu reddedilir.
 * Route sırası: sabit path'ler (/stages, /stages/reorder) parametrik
 * /stages/:stageId'den önce tanımlıdır.
 */

import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/authorize.js';
import {
  adminListStages,
  adminCreateStage,
  adminUpdateStage,
  adminDeleteStage,
  adminCustomizeStage,
  adminHideStage,
  adminUnhideStage,
  adminReorderStages,
} from '../controllers/learningJourneyAdminController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);
router.use(requireRole('ADMIN') as unknown as RequestHandler);

// ── Sabit path'ler ────────────────────────────────────────────────────────────
router.get('/stages', adminListStages as unknown as RequestHandler);
router.post('/stages', adminCreateStage as unknown as RequestHandler);
router.post('/stages/reorder', adminReorderStages as unknown as RequestHandler);

// ── Parametrik path'ler ───────────────────────────────────────────────────────
router.patch('/stages/:stageId', adminUpdateStage as unknown as RequestHandler);
router.delete('/stages/:stageId', adminDeleteStage as unknown as RequestHandler);
router.post('/stages/:stageId/customize', adminCustomizeStage as unknown as RequestHandler);
router.post('/stages/:stageId/hide', adminHideStage as unknown as RequestHandler);
router.delete('/stages/:stageId/hide', adminUnhideStage as unknown as RequestHandler);

export default router;
