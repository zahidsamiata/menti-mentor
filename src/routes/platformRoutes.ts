import { Router } from 'express';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { platformAuthRateLimiter, platformReadRateLimiter } from '../middleware/rateLimiter.js';
import {
  platformLogin,
  platformLogout,
  getPlatformStats,
  getPlatformHealth,
  getPlatformLogs,
  listPendingTenants,
  listAllTenants,
  approveTenant,
  rejectTenant,
  freezeTenant,
  activateTenant,
  listSuspicionReports,
  reviewSuspicionReport,
  listUserReports,
  reviewUserReport,
  getAnomalies,
} from '../controllers/platformController.js';
import {
  getTenantOverview,
  getTenantMembers,
  getTenantMeetings,
  getTenantAnalytics,
} from '../controllers/platformTenantController.js';

const router = Router();

// Public: e-posta + şifre ile platform auth / logout
// Güvenlik: /auth brute-force'a açık → IP-bazlı sıkı rate-limit.
router.post('/auth', platformAuthRateLimiter, platformLogin);
router.post('/logout', platformLogout);

// Protected: platform-admin token tüm aşağıdaki endpoint'ler için zorunlu.
// Ardından IP-bazlı makul okuma limiti (X-Tenant-Id taşımayan platform trafiği için).
router.use(requirePlatformAdmin);
router.use(platformReadRateLimiter);

// ─── Genel ───────────────────────────────────────────────────────────────────
router.get('/stats', getPlatformStats);
router.get('/health', getPlatformHealth);
router.get('/logs', getPlatformLogs);

// ─── Kurum Yönetimi ───────────────────────────────────────────────────────────
router.get('/tenants/pending', listPendingTenants);
router.get('/tenants', listAllTenants);
router.post('/tenants/:id/approve', approveTenant);
router.post('/tenants/:id/reject', rejectTenant);
router.post('/tenants/:id/freeze', freezeTenant);
router.post('/tenants/:id/activate', activateTenant);

// ─── Kurum Derin Görünüm (deep panel) — salt-okuma, maskeli, audit'li ──────────
router.get('/tenants/:id/overview', getTenantOverview);
router.get('/tenants/:id/members', getTenantMembers);
router.get('/tenants/:id/meetings', getTenantMeetings);
router.get('/tenants/:id/analytics', getTenantAnalytics);

// ─── Şüphe Bildirimleri ───────────────────────────────────────────────────────
router.get('/suspicion-reports', listSuspicionReports);
router.post('/suspicion-reports/:id/review', reviewSuspicionReport);

// ─── Kullanıcı Şikayetleri (sistem-geneli) + Otomatik Tespit ──────────────────
router.get('/user-reports', listUserReports);
router.patch('/user-reports/:id', reviewUserReport);
router.get('/anomalies', getAnomalies);

export default router;
