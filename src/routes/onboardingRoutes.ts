import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { requireAuth } from '../middleware/authorize.js';
import {
  completeProfile,
  submitDiscTest,
  getDiscQuestions,
  updateSocialProfile,
  submitMatchingPreferences,
} from '../controllers/onboardingController.js';

const router = Router();

// Tüm onboarding endpoint'leri tenant izolasyonu + kimlik doğrulaması gerektirir.
router.use(requireTenant as unknown as RequestHandler);

// ─── Profil tamamlama ─────────────────────────────────────────────────────────
// POST /api/users/profile/complete
// Giriş yapmış üye (MENTOR/MENTI) sektör, beceri ve deneyim yılını kaydeder.
router.post(
  '/users/profile/complete',
  requireAuth(),
  completeProfile as unknown as RequestHandler,
);

// ─── DISC Test ────────────────────────────────────────────────────────────────
// GET  /api/users/disc/questions  → 8 onboarding sorusunu listele (seçenek boyutları gizli)
// POST /api/users/disc/submit     → Cevapları işle, "Aha Anı" kartını kaydet ve döndür
router.get(
  '/users/disc/questions',
  requireAuth(),
  getDiscQuestions as unknown as RequestHandler,
);

router.post(
  '/users/disc/submit',
  requireAuth(),
  submitDiscTest as unknown as RequestHandler,
);

router.patch(
  '/users/me/social',
  requireAuth(),
  updateSocialProfile as unknown as RequestHandler,
);

// ─── Üç soru (S1/S2/S3) — arketip kartından sonra toplanır (tasarım §10.2) ────
// PATCH /api/users/me/matching-preferences → dört alanı doldurur (migration YOK; alanlar mevcut).
router.patch(
  '/users/me/matching-preferences',
  requireAuth(),
  submitMatchingPreferences as unknown as RequestHandler,
);

export default router;
