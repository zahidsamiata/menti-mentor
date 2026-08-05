import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import authRoutes from './routes/authRoutes.js';
import platformRoutes from './routes/platformRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import selfServeRoutes from './routes/selfServeRoutes.js';
import invitationRoutes from './routes/invitationRoutes.js';
import onboardingRoutes from './routes/onboardingRoutes.js';
import adminSettingsRoutes from './routes/adminSettingsRoutes.js';
import superAdminRoutes from './routes/superAdminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import jobListingRoutes from './routes/jobListingRoutes.js';
import meetingRoutes from './routes/meetingRoutes.js';
import feedbackLogRoutes from './routes/feedbackLogRoutes.js';
import clubRoutes from './routes/clubRoutes.js';
import systemLogRoutes from './routes/systemLogRoutes.js';
import questionRoutes from './routes/questionRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { suggestTag } from './controllers/tagController.js';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { generalRateLimiter } from './middleware/rateLimiter.js';
import { startCronScheduler } from './services/cronScheduler.js';
import { ensureUploadDir } from './services/avatarStorage.js';
import sjtScoringRoutes from './routes/sjtScoringRoutes.js';
import suspicionRoutes from './routes/suspicionRoutes.js';
import agreementRoutes from './routes/agreementRoutes.js';
import learningJourneyRoutes from './routes/learningJourneyRoutes.js';
import learningJourneyAdminRoutes from './routes/learningJourneyAdminRoutes.js';
import type { RequestHandler } from 'express';

const app = express();

/**
 * Helmet: production HTTP güvenlik başlıklarını otomatik ekler.
 * contentSecurityPolicy: API sunucusu olduğu için kapatılır (HTML döndürmez).
 * crossOriginEmbedderPolicy: false — bazı tarayıcı istek türleriyle çakışır.
 */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3001,http://127.0.0.1:3001').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/health', (_req, res) => res.json({
  ok: true,
  env: config.nodeEnv,
  ts: new Date().toISOString(),
  version: process.env.npm_package_version ?? '0.1.0',
  uptime: Math.floor(process.uptime()),
}));

// ─── Yüklenen avatarların statik servisi ─────────────────────────────────────
// /uploads → kalıcı disk (UPLOAD_DIR). Yalnızca görsel dosyalar bulunur; yine de
// güvenlik başlıklarıyla script yürütme/aktif içerik render engellenir:
//   - X-Content-Type-Options: nosniff → tarayıcı MIME tahmini yapmaz.
//   - CSP sandbox + default-src 'none' → içerik aktif kaynak olarak yorumlanmaz.
//   - index:false, dotfiles:deny → dizin listeleme ve gizli dosya erişimi kapalı.
app.use(
  '/uploads',
  express.static(config.upload.dir, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  }),
);

// Rate limiter: /api/* endpoint'lerine uygula (health ve static hariç)
app.use('/api', generalRateLimiter);

// ─── Platform yöneticisi (tenant sisteminin dışında) ────────────────────────
app.use('/api/platform', platformRoutes);

// ─── Şüphe bildirimi (herkese açık) ─────────────────────────────────────────
app.use('/api/suspicion-reports', suspicionRoutes);

// ─── Kimlik doğrulama (tenant gerektirmez) ───────────────────────────────────
app.use('/api/auth', authRoutes);

// ─── Davet sistemi (herkese açık, tenant gerektirmez) ────────────────────────
app.use('/api/invitations', invitationRoutes);

// ─── Self-Serve onboarding (X-Tenant-Id gerektirmez, JWT ile korunan) ─────────
// tenantRoutes'tan ÖNCE mount edilmeli: /:id/onboarding ve /:slug/preview path'leri
// tenantRoutes'taki /:id tek-segment pattern'ıyla çakışmaz; bu route'lar iki segmentlidir.
app.use('/api/tenants', selfServeRoutes);

// ─── Dernek yöneticisi program ayarları (X-Tenant-Id gerektirmez, JWT ADMIN) ─
// /:id/settings ve /:id/block-pair — iki-segment path'ler, tenantRoutes ile çakışmaz.
app.use('/api/tenants', adminSettingsRoutes);

// ─── Uygulama Yöneticisi (Super Admin) ──────────────────────────────────────
app.use('/api/super-admin', superAdminRoutes);

// ─── Global tenant yönetimi ──────────────────────────────────────────────────
app.use('/api/tenants', tenantRoutes);

// ─── Onboarding (profil tamamlama + DISC testi) ──────────────────────────────
// userRoutes'tan ÖNCE: /users/profile/complete ve /users/disc/* sabit path'ler,
// userRoutes'taki /users/:id dinamik segment'iyle çakışmaz.
app.use('/api', onboardingRoutes);

// ─── Tenant-scope endpoint'ler ───────────────────────────────────────────────
app.use('/api', userRoutes);
app.use('/api/job-listings', jobListingRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/feedback-logs', feedbackLogRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/system-logs', systemLogRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/analytics', analyticsRoutes);
// Öğrenme Yolculuğu STK paneli — /api/admin (adminRoutes) ÖNCESİNE mount edilir ki
// daha spesifik prefix ilk eşleşsin (adminRoutes'ta gereksiz middleware'e düşmesin).
app.use('/api/admin/learning-journey', learningJourneyAdminRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/scoring', sjtScoringRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/learning-journey', learningJourneyRoutes);
// Kullanıcı etiket önerisi (authenticated, tenant-scoped)
app.post('/api/tags/suggest', generalRateLimiter, suggestTag as unknown as RequestHandler);

// Hata yönetimi — route'lardan sonra olmalı
app.use(notFoundHandler);
app.use(globalErrorHandler);

const server = app.listen(config.port, () => {
  console.log(`API ayakta: http://localhost:${config.port} [${config.nodeEnv}]`);
  // Avatar upload dizini (kalıcı disk) yoksa oluştur — statik servis boş dizinde de çalışır.
  void ensureUploadDir().catch((err) => {
    console.error('Upload dizini oluşturulamadı:', err instanceof Error ? err.message : err);
  });
  startCronScheduler();
});

/**
 * Graceful shutdown — 10 saniye timeout sonrası zorla çıkar.
 * Docker stop 10s bekler; bu süre içinde tamamlanmayan istekler kesilir.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`${signal} alındı — sunucu kapatılıyor...`);

  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown zaman aşımı — zorla çıkılıyor.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  server.close(async () => {
    clearTimeout(forceExit);
    const { prisma } = await import('./db.js');
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
