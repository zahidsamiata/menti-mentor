import { Router, type RequestHandler } from 'express';
import { requireTenant } from '../middleware/tenant.js';
import { loginRateLimiter, passwordResetRateLimiter } from '../middleware/rateLimiter.js';
import {
  register,
  login,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  oauthRedirect,
  oauthCallback,
  getMe,
} from '../controllers/authController.js';

const router = Router();

// POST /api/auth/register — yeni kullanıcı kaydı (tenant gerektirmez)
router.post('/register', register as unknown as RequestHandler);

// POST /api/auth/login — e-posta + şifre ile giriş.
// loginRateLimiter: IP-bazlı brute-force koruması (generalRateLimiter'a ek).
router.post('/login', loginRateLimiter, login as unknown as RequestHandler);

// POST /api/auth/refresh — refresh token ile yeni access token al
router.post('/refresh', refresh as unknown as RequestHandler);

// POST /api/auth/logout — refresh token'ı iptal et (204)
router.post('/logout', logout as unknown as RequestHandler);

// POST /api/auth/forgot-password — şifre sıfırlama e-postası gönder.
// passwordResetRateLimiter: IP-bazlı — kullanıcı-tarama + mail-DoS koruması.
router.post('/forgot-password', passwordResetRateLimiter, forgotPassword as unknown as RequestHandler);

// POST /api/auth/reset-password — token + yeni şifre ile şifre güncelle.
// passwordResetRateLimiter: IP-bazlı — token brute-force koruması.
router.post('/reset-password', passwordResetRateLimiter, resetPassword as unknown as RequestHandler);

// GET /api/auth/me — mevcut token sahibinin profilini döndürür (tenant gerektirir)
router.get('/me', requireTenant as unknown as RequestHandler, getMe as unknown as RequestHandler);

/**
 * OAuth akış route'ları — dinamik :provider parametresi ile iki provider'ı tek handler'da yönetir.
 * Desteklenen değerler: "google" | "linkedin"
 *
 * Adım 1 — Başlatma:  GET /api/auth/:provider?tenantSlug=tech-hub&role=MENTOR
 * Adım 2 — Callback:  GET /api/auth/:provider/callback?code=...&state=...
 */
router.get('/:provider', oauthRedirect as unknown as RequestHandler);
router.get('/:provider/callback', oauthCallback as unknown as RequestHandler);

export default router;
