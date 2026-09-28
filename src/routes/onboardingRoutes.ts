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
import cspReportRoutes from './cspReportRoutes.js';

const router = Router();

// ─── CSP ihlal raporu (PUBLIC — tarayıcı oturumsuz gönderir; AJ-52) ──────────
// POST /api/csp-reports. Neden burada: bu router server.ts'te `/api` altına, genel `/api` oran
// sınırının ARKASINDA bağlı; server.ts bu turda dokunulmaz olduğu için uç yeni bir mount yerine
// buradan sunulur. `requireTenant`'tan ÖNCE bağlanmalı (tarayıcı X-Tenant-Id / kimlik göndermez);
// uç her isteği kendisi sonlandırır (204/429), aşağıdaki tenant/kimlik zincirine düşmez.
router.use('/csp-reports', cspReportRoutes);

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
