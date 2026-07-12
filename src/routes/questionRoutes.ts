/**
 * Soru havuzu route'ları.
 *
 * Route sırası önemlidir:
 *   /respond (POST, sabit)    — toplu endpoint; /:questionId/respond'dan önce tanımlanmalı
 *   /my-responses (GET, sabit) — /:questionId parametresi ile çakışmaması için önce gelir
 *   /:questionId/respond (POST, parametrik) — frontend tarafından kullanılan tek soru endpoint'i
 *
 * Bu sıralama Express'in route'ları üstten aşağıya eşleştirmesi nedeniyle zorunludur.
 */

import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import {
  listQuestions,
  createQuestion,
  respondToQuestion,
  submitResponses,
  getMyResponses,
  updateQuestion,
  deleteQuestion,
  hideGlobalQuestion,
  unhideGlobalQuestion,
} from '../controllers/questionController.js';

const router = Router();
router.use(requireTenant as unknown as RequestHandler);

// ── Sabit path'ler (parametrik route'lardan önce) ─────────────────────────────

/** GET /api/questions — soru listesi + pool meta verisi (kimlik doğrulaması zorunlu) */
router.get('/', requireAuth(), listQuestions as unknown as RequestHandler);

/** POST /api/questions — yeni soru ekle (yalnızca ADMIN) */
router.post('/', requireRole('ADMIN'), createQuestion as unknown as RequestHandler);

/**
 * POST /api/questions/respond — toplu yanıt (proje içi / data migration)
 *
 * Uyarı: Bu route /:questionId/respond'dan ÖNCE tanımlı olmalı.
 * Aksi takdirde "respond" kelimesi questionId olarak parse edilir.
 */
router.post('/respond', requireAuth(), submitResponses as unknown as RequestHandler);

/** GET /api/questions/my-responses — kullanıcının adaptif ilerleme durumu (kimlik doğrulaması zorunlu) */
router.get('/my-responses', requireAuth(), getMyResponses as unknown as RequestHandler);

// ── Soru Yönetimi (ADMIN — sabit path'lerden sonra, parametrik'ten önce) ─────

/** PATCH /api/questions/:questionId — tenant sorusunu güncelle (metin/sıra/zorunluluk) */
router.patch('/:questionId', requireRole('ADMIN'), updateQuestion as unknown as RequestHandler);

/** DELETE /api/questions/:questionId — tenant sorusunu sil (global soru silinemez) */
router.delete('/:questionId', requireRole('ADMIN'), deleteQuestion as unknown as RequestHandler);

/** POST /api/questions/:questionId/hide — global soruyu bu tenant için gizle */
router.post('/:questionId/hide', requireRole('ADMIN'), hideGlobalQuestion as unknown as RequestHandler);

/** DELETE /api/questions/:questionId/hide — global soruyu yeniden göster */
router.delete('/:questionId/hide', requireRole('ADMIN'), unhideGlobalQuestion as unknown as RequestHandler);

// ── Parametrik path'ler ───────────────────────────────────────────────────────

/**
 * POST /api/questions/:questionId/respond — tek soru yanıtı (frontend kullanır)
 */
router.post('/:questionId/respond', requireAuth(), respondToQuestion as unknown as RequestHandler);

export default router;
