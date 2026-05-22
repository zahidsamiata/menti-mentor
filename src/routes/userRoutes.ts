import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth, requireRole } from '../middleware/authorize.js';
import { createUser, listUsers, getUser, updateUser, patchSelfProfile } from '../controllers/userController.js';
import { submitTemperamentTest } from '../controllers/temperamentController.js';
import { getRankedMentisForMentor, setVisibilityOptIn } from '../controllers/matchingController.js';
import { createMatchRequest, listRequests, getRequest } from '../controllers/requestController.js';
import { getUserClubs } from '../controllers/clubController.js';

const router = Router();

// Tüm bu router'daki endpoint'lere tenant izolasyonu uygulanır.
// requireTenant async olduğu için cast gerekli.
router.use(requireTenant as unknown as RequestHandler);

// ─── Kullanıcı yönetimi ───────────────────────────────────────────────────────
// GET  /users        → tenant içindeki herkes (kimlik doğrulaması gerekmez)
router.get('/users', listUsers as unknown as RequestHandler);

// POST /users        → yalnızca ADMIN
router.post('/users', requireRole('ADMIN'), createUser as unknown as RequestHandler);

// GET  /users/:id    → tenant içindeki herkes
router.get('/users/:id', getUser as unknown as RequestHandler);

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

// POST /mentors/:mentorId/visibility-optin → ADMIN veya MENTOR (ice-breaker Rule 3 burada tetiklenir)
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
router.get('/users/:userId/clubs', getUserClubs as unknown as RequestHandler);

// ─── Serbest profil metadata ──────────────────────────────────────────────────
// PATCH /users/:id/self-profile → kendi kaydını güncelleyebilir (ADMIN veya sahibi)
router.patch(
  '/users/:id/self-profile',
  requireAuth(),
  patchSelfProfile as unknown as RequestHandler,
);

export default router;
