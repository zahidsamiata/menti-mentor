import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import { createUser, listUsers, getUser, updateUser, patchSelfProfile, countApprovedMentors, updateMyProfile } from '../controllers/userController.js';
import { submitTemperamentTest } from '../controllers/temperamentController.js';
import { getRankedMentisForMentor, setVisibilityOptIn } from '../controllers/matchingController.js';
import { createMatchRequest, listRequests, getRequest } from '../controllers/requestController.js';
import { getUserClubs } from '../controllers/clubController.js';
import { anonymizeUserHandler, hardDeleteUserHandler, exportUserDataHandler } from '../controllers/gdprController.js';
import { completedOrientation } from '../controllers/userController.js';
import { requestVisibilityFromMentor, getPendingVisibilityRequests, respondToVisibilityRequest } from '../controllers/mentiRequestController.js';
import { getMentorFilter, upsertMentorFilter } from '../controllers/mentorFilterController.js';
import { getNextAdaptiveQuestion, submitAdaptiveAnswer, previewAdaptiveResult } from '../controllers/adaptiveTestController.js';

const router = Router();

// Tüm bu router'daki endpoint'lere tenant izolasyonu uygulanır.
// requireTenant async olduğu için cast gerekli.
router.use(requireTenant as unknown as RequestHandler);

// ─── Kullanıcı yönetimi ───────────────────────────────────────────────────────
// GET  /users        → kimlik doğrulaması zorunlu
router.get('/users', requireAuth(), listUsers as unknown as RequestHandler);

// GET  /users/mentor-count → PENDING dahil tüm kimliği doğrulanmış kullanıcılara açık.
// Yalnızca onaylı mentor SAYISINI döner (PII yok). /users/:id'den önce tanımlanmalı.
router.get('/users/mentor-count', requireAuth(), countApprovedMentors as unknown as RequestHandler);

// POST /users        → yalnızca ADMIN
router.post('/users', requireRole('ADMIN'), createUser as unknown as RequestHandler);

// GET  /users/:id    → kimlik doğrulaması zorunlu
router.get('/users/:id', requireAuth(), getUser as unknown as RequestHandler);

// PATCH /users/me/profile → kullanıcı kendi profilini düzenler (whitelist korumalı)
router.patch(
  '/users/me/profile',
  requireAuth(),
  updateMyProfile as unknown as RequestHandler,
);

// PATCH /users/:id   → yalnızca ADMIN
router.patch('/users/:id', requireRole('ADMIN'), updateUser as unknown as RequestHandler);

// ─── Mizaç testi ─────────────────────────────────────────────────────────────
// POST /users/:id/temperament-test → ADMIN veya MENTI
router.post(
  '/users/:id/temperament-test',
  requireRole('ADMIN', 'MENTI'),
  submitTemperamentTest as unknown as RequestHandler,
);

// ─── Mentor ekranı ───────────────────────────────────────────────────────────
// GET  /mentors/:mentorId/candidates → ADMIN veya MENTOR (Anti-Match filtresi matching.ts içinde aktif)
router.get(
  '/mentors/:mentorId/candidates',
  requireRole('ADMIN', 'MENTOR'),
  getRankedMentisForMentor as unknown as RequestHandler,
);

// POST /mentors/:mentorId/visibility-optin → ADMIN veya MENTOR
router.post(
  '/mentors/:mentorId/visibility-optin',
  requireRole('ADMIN', 'MENTOR'),
  setVisibilityOptIn as unknown as RequestHandler,
);

// ─── Eşleşme istekleri ───────────────────────────────────────────────────────
router.get('/requests', requireAuth(), listRequests as unknown as RequestHandler);
router.get('/requests/:id', requireAuth(), getRequest as unknown as RequestHandler);
router.post('/requests', requireAuth(), createMatchRequest as unknown as RequestHandler);

// ─── Kullanıcının kulüpleri ───────────────────────────────────────────────────
router.get('/users/:userId/clubs', requireAuth(), getUserClubs as unknown as RequestHandler);

// ─── Serbest profil metadata ──────────────────────────────────────────────────
// PATCH /users/:id/self-profile → kendi kaydını güncelleyebilir (ADMIN veya sahibi)
router.patch(
  '/users/:id/self-profile',
  requireAuth(),
  patchSelfProfile as unknown as RequestHandler,
);

// ─── Adaptif Test Motoru (Sprint 5) ──────────────────────────────────────────
// GET  /users/:id/adaptive-test/next     → Sıradaki soruyu döndür (veya test bitti + DISC vektörü)
// POST /users/:id/adaptive-test/answer   → Yanıt kaydet + sıradaki soruyu döndür
// GET  /users/:id/adaptive-test/preview  → Anlık DISC tahminini döndür (test bitmeden)
router.get(
  '/users/:id/adaptive-test/next',
  requireAuth(),
  getNextAdaptiveQuestion as unknown as RequestHandler,
);
router.post(
  '/users/:id/adaptive-test/answer',
  requireAuth(),
  submitAdaptiveAnswer as unknown as RequestHandler,
);
router.get(
  '/users/:id/adaptive-test/preview',
  requireAuth(),
  previewAdaptiveResult as unknown as RequestHandler,
);

// ─── Mentor Kişisel Filtresi ──────────────────────────────────────────────────
// GET  /mentors/:mentorId/filter → kaydedilmiş filtre tercihlerini döner
// PUT  /mentors/:mentorId/filter → tercihleri kaydeder/günceller
router.get(
  '/mentors/:mentorId/filter',
  requireRole('ADMIN', 'MENTOR'),
  getMentorFilter as unknown as RequestHandler,
);
router.put(
  '/mentors/:mentorId/filter',
  requireRole('ADMIN', 'MENTOR'),
  upsertMentorFilter as unknown as RequestHandler,
);

// ─── Hibrit Akış: Menti-driven görünürlük talebi ─────────────────────────────
router.post(
  '/mentis/:mentiId/request-visibility',
  requireAuth(),
  requestVisibilityFromMentor as unknown as RequestHandler,
);
router.get(
  '/mentors/:mentorId/pending-visibility-requests',
  requireRole('ADMIN', 'MENTOR'),
  getPendingVisibilityRequests as unknown as RequestHandler,
);
router.patch(
  '/mentors/:mentorId/visibility-optin/:optInId/respond',
  requireRole('ADMIN', 'MENTOR'),
  respondToVisibilityRequest as unknown as RequestHandler,
);

// ─── Oryantasyon kilidi — kullanıcı kendi kilidini kaldırır (rehber tamamlandı) ──
// POST /users/me/orientation-completed → needsOrientation=false (MENTI)
router.post(
  '/users/me/orientation-completed',
  requireRole('MENTI'),
  completedOrientation as unknown as RequestHandler,
);

// ─── KVKK / GDPR hakları ─────────────────────────────────────────────────────
// POST   /users/:id/anonymize   → yalnızca ADMIN (KVKK Md.7 / GDPR Md.17 — anonimleştirme)
// DELETE /users/:id/hard-delete → yalnızca ADMIN (GDPR Md.17 — kalıcı silme)
// GET    /users/:id/export      → kullanıcı kendisi veya ADMIN (KVKK Md.11 / GDPR Md.20)
router.post(
  '/users/:id/anonymize',
  requireRole('ADMIN'),
  anonymizeUserHandler as unknown as RequestHandler,
);
router.delete(
  '/users/:id/hard-delete',
  requireRole('ADMIN'),
  hardDeleteUserHandler as unknown as RequestHandler,
);
router.get(
  '/users/:id/export',
  requireAuth(),
  exportUserDataHandler as unknown as RequestHandler,
);

export default router;
