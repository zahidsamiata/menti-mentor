/**
 * HTTP test yardımcıları — Supertest wrapper.
 *
 * createTestApp(): Her çağrıda yeni Express instance döndürür; test izolasyonu sağlar.
 * loginAs(): Kullanıcıya ait geçerli JWT döner; test isteklerinde kullanılır.
 */

import supertest from 'supertest';
import type { SuperTestStatic } from 'supertest';
import express from 'express';
import cors from 'cors';
import authRoutes          from '../../src/routes/authRoutes.js';
import tenantRoutes        from '../../src/routes/tenantRoutes.js';
import selfServeRoutes     from '../../src/routes/selfServeRoutes.js';
import adminSettingsRoutes from '../../src/routes/adminSettingsRoutes.js';
import userRoutes          from '../../src/routes/userRoutes.js';
import onboardingRoutes    from '../../src/routes/onboardingRoutes.js';
import adminRoutes         from '../../src/routes/adminRoutes.js';
import questionRoutes      from '../../src/routes/questionRoutes.js';
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
  app.use('/api/auth',    authRoutes);
  app.use('/api/tenants', selfServeRoutes);
  app.use('/api/tenants', adminSettingsRoutes);
  app.use('/api/tenants', tenantRoutes);
  app.use('/api',         onboardingRoutes);
  app.use('/api',         userRoutes);
  app.use('/api/admin',   adminRoutes);
  app.use('/api/questions', questionRoutes);
  app.post('/api/tags/suggest', suggestTag as unknown as RequestHandler);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

/** supertest instance — her test dosyasında yeni app üzerinde çalışır. */
export type TestAgent = ReturnType<SuperTestStatic>;

export function agent(): TestAgent {
  return supertest(createTestApp());
}

// ─── Auth yardımcıları ────────────────────────────────────────────────────────

export interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * E-posta + şifre ile giriş yapar ve token çiftini döner.
 * Factory ile oluşturulan kullanıcılar için kullanılır.
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

  const body = res.body as { accessToken: string; refreshToken: string };
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

/** Tenant-scope istek için standart header'ları döner. */
export function tenantHeaders(tenantId: string, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Tenant-Id': tenantId };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  return headers;
}
