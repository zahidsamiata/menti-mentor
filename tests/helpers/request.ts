/**
 * HTTP test yardımcıları — Supertest wrapper.
 *
 * createTestApp(): Her çağrıda yeni Express instance döndürür; test izolasyonu sağlar.
 * loginAs(): Kullanıcıya ait geçerli JWT döner; test isteklerinde kullanılır.
 */

import supertest from 'supertest';
import express from 'express';
import cors from 'cors';
import authRoutes          from '../../src/routes/authRoutes.js';
import suspicionRoutes     from '../../src/routes/suspicionRoutes.js';
import invitationRoutes    from '../../src/routes/invitationRoutes.js';
import tenantRoutes        from '../../src/routes/tenantRoutes.js';
import selfServeRoutes     from '../../src/routes/selfServeRoutes.js';
import adminSettingsRoutes from '../../src/routes/adminSettingsRoutes.js';
import userRoutes          from '../../src/routes/userRoutes.js';
import onboardingRoutes    from '../../src/routes/onboardingRoutes.js';
import adminRoutes         from '../../src/routes/adminRoutes.js';
import questionRoutes      from '../../src/routes/questionRoutes.js';
import analyticsRoutes     from '../../src/routes/analyticsRoutes.js';
import platformRoutes      from '../../src/routes/platformRoutes.js';
import superAdminRoutes    from '../../src/routes/superAdminRoutes.js';
import agreementRoutes     from '../../src/routes/agreementRoutes.js';
import meetingRoutes       from '../../src/routes/meetingRoutes.js';
import sjtScoringRoutes    from '../../src/routes/sjtScoringRoutes.js';
import learningJourneyRoutes      from '../../src/routes/learningJourneyRoutes.js';
import learningJourneyAdminRoutes from '../../src/routes/learningJourneyAdminRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../../src/middleware/errorHandler.js';
import { generalRateLimiter } from '../../src/middleware/rateLimiter.js';
import { suggestTag } from '../../src/controllers/tagController.js';
import type { RequestHandler, Express } from 'express';

/**
 * Test Express uygulaması — cron ve DB bağlantısı olmadan.
 * Route sırası server.ts ile birebir aynı tutulur:
 *   selfServe → adminSettings → onboarding ÖNCE, ardından genel userRoutes.
 * Bu sıra, /users/disc/* gibi sabit path'lerin /:id dinamik segmentiyle
 * çakışmamasını güvence altına alır.
 */
export function createTestApp(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cors());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', generalRateLimiter);
  app.use('/api/platform',     platformRoutes);
  app.use('/api/suspicion-reports', suspicionRoutes);
  app.use('/api/super-admin',  superAdminRoutes);
  app.use('/api/auth',         authRoutes);
  app.use('/api/invitations',  invitationRoutes);
  app.use('/api/tenants',      selfServeRoutes);
  app.use('/api/tenants',      adminSettingsRoutes);
  app.use('/api/tenants',      tenantRoutes);
  app.use('/api',              onboardingRoutes);
  app.use('/api',              userRoutes);
  app.use('/api/admin/learning-journey', learningJourneyAdminRoutes);
  app.use('/api/admin',        adminRoutes);
  app.use('/api/questions',    questionRoutes);
  app.use('/api/analytics',    analyticsRoutes);
  app.use('/api/learning-journey', learningJourneyRoutes);
  app.use('/api/agreements',   agreementRoutes);
  app.use('/api/meetings',     meetingRoutes);
  app.use('/api/scoring',      sjtScoringRoutes);
  app.post('/api/tags/suggest', suggestTag as unknown as RequestHandler);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

/** supertest.agent — cookie jar'ı korur (HttpOnly refresh token akışı için gerekli) */
export type TestAgent = ReturnType<typeof supertest.agent>;

export function agent(): TestAgent {
  return supertest.agent(createTestApp());
}

// ─── Auth yardımcıları ────────────────────────────────────────────────────────

export interface LoginTokens {
  accessToken: string;
}

/**
 * E-posta + şifre ile giriş yapar; accessToken döner.
 * refreshToken artık HttpOnly cookie'de — agent cookie jar'ı otomatik yönetir.
 */
export async function loginAs(
  http: TestAgent,
  email: string,
  password: string,
): Promise<LoginTokens> {
  const res = await http
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  const body = res.body as { accessToken: string };
  return { accessToken: body.accessToken };
}

/** Tenant-scope istek için standart header'ları döner. */
export function tenantHeaders(tenantId: string, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Tenant-Id': tenantId };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}
