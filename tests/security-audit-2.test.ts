/**
 * DevSecOps Denetimi #2 — Güvenlik Düzeltme Testleri
 *
 * YÜKSEK-1: Platform admin token HttpOnly cookie'de (localStorage yok)
 * YÜKSEK-2: Tenant başına ADMIN limiti (max 3) + audit log
 * YÜKSEK-3: FeedbackLog rol bazlı erişim — MENTI göremez, MENTOR sadece kendi
 * YÜKSEK-4: getMeetingFeedback — taraf kontrolü + KARAR 1 alan filtresi
 * YÜKSEK-5: submitTemperamentTest — isSelf || isAdmin
 * ORTA-2:   patchSelfProfile — isSelf || isAdmin
 * ORTA-3:   createAgreement — taraf kontrolü
 * ORTA-4:   getFeedbackLog/:id — taraf kontrolü
 */

import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import cors from 'cors';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import feedbackLogRoutes from '../src/routes/feedbackLogRoutes.js';
import platformRoutes from '../src/routes/platformRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import { generalRateLimiter } from '../src/middleware/rateLimiter.js';
import type { Tenant, User } from '@prisma/client';

// ─── Minimal test app'leri ──────────────────────────────────────────────────

function createFeedbackLogTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cors());
  app.use('/api', generalRateLimiter);
  app.use('/api/feedback-logs', feedbackLogRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

function createPlatformTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cors({ credentials: true }));
  app.use('/api', generalRateLimiter);
  app.use('/api/platform', platformRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

// ═══════════════════════════════════════════════════════════════════════════
// YÜKSEK-1: Platform admin cookie
// ═══════════════════════════════════════════════════════════════════════════

describe('YÜKSEK-1: Platform admin cookie auth', () => {
  const platHttp = supertest.agent(createPlatformTestApp());

  const ADMIN_EMAIL = process.env['PLATFORM_ADMIN_EMAIL'] ?? 'admin@platform.local';
  const ADMIN_KEY   = process.env['PLATFORM_ADMIN_KEY']   ?? 'test-platform-key';

  it('platformLogin → accessToken JSON gelmez, Set-Cookie başlığı gelir', async () => {
    const res = await platHttp
      .post('/api/platform/auth')
      .send({ email: ADMIN_EMAIL, password: ADMIN_KEY });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('ok', true);
    const rawCookie: unknown = res.headers['set-cookie'];
    const setCookie = Array.isArray(rawCookie) ? (rawCookie as string[]) : undefined;
    expect(setCookie).toBeDefined();
    const tokenCookie = (setCookie ?? []).find((c) => c.startsWith('platform_token='));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/HttpOnly/i);
  });

  it('yanlış şifre → 401, Set-Cookie yok', async () => {
    const res = await platHttp
      .post('/api/platform/auth')
      .send({ email: ADMIN_EMAIL, password: 'yanlis' });

    expect(res.status).toBe(401);
    const rawCookie: unknown = res.headers['set-cookie'];
    const setCookie = Array.isArray(rawCookie) ? (rawCookie as string[]) : undefined;
    const tokenCookie = (setCookie ?? []).find((c) => c.startsWith('platform_token='));
    expect(tokenCookie).toBeUndefined();
  });

  it('Authorization header ile platform endpoint → 401 (cookie olmadan geçmez)', async () => {
    // Taze agent: önceki testten cookie taşımamak için yeni instance
    const freshHttp = supertest.agent(createPlatformTestApp());
    const fakeToken = 'Bearer fake.jwt.token';
    const res = await freshHttp
      .get('/api/platform/stats')
      .set('Authorization', fakeToken);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// YÜKSEK-2: Admin limiti (max 3)
// ═══════════════════════════════════════════════════════════════════════════

describe('YÜKSEK-2: Tenant başına max 3 admin limiti', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let admin: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    admin = await createAdminUser(tenant.id);
  });

  it('3 adminden sonra promote-admin → 403', async () => {
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);

    // admin + 2 daha = 3 (limit doldu)
    await createAdminUser(tenant.id);
    await createAdminUser(tenant.id);

    const mentor = await createMentor(tenant.id);
    const res = await http
      .post(`/api/admin/users/${mentor.id}/promote-admin`)
      .set(tenantHeaders(tenant.id, accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ADMIN_LIMITI_ASILDI');
  });

  it('2 admin varken promote-admin → 200 (limit dolmamış)', async () => {
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    await createAdminUser(tenant.id); // 2. admin

    const mentor = await createMentor(tenant.id);
    const res = await http
      .post(`/api/admin/users/${mentor.id}/promote-admin`)
      .set(tenantHeaders(tenant.id, accessToken));

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// YÜKSEK-3: FeedbackLog erişim kontrolü
// ═══════════════════════════════════════════════════════════════════════════

describe('YÜKSEK-3: FeedbackLog — rol bazlı erişim', () => {
  const flHttp = supertest.agent(createFeedbackLogTestApp());
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    menti  = await createMenti(tenant.id);
  });

  it('MENTI GET /api/feedback-logs → 200 ama items boş dizi (erişim yok)', async () => {
    const http2 = agent();
    const { accessToken } = await loginAs(http2, menti.email, menti.rawPassword);
    const res = await flHttp
      .get('/api/feedback-logs')
      .set(tenantHeaders(tenant.id, accessToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('MENTOR GET /api/feedback-logs sadece kendi kayıtlarını görür', async () => {
    const http2 = agent();
    const { accessToken } = await loginAs(http2, mentor.email, mentor.rawPassword);

    // Başka mentor oluştur — onun kaydı bu mentor'a gözükmemeli
    const otherMentor = await createMentor(tenant.id);
    const http3 = agent();
    const { accessToken: otherToken } = await loginAs(http3, otherMentor.email, otherMentor.rawPassword);

    // otherMentor kendi feedback log'unu oluştursun
    await flHttp
      .post('/api/feedback-logs')
      .set(tenantHeaders(tenant.id, otherToken))
      .send({ mentorId: otherMentor.id, mentiId: menti.id, phase: 1, starRating: 4 });

    // mentor için feedback log yok — sadece kendi kayıtları görünmeli
    const res = await flHttp
      .get('/api/feedback-logs')
      .set(tenantHeaders(tenant.id, accessToken));

    expect(res.status).toBe(200);
    // mentor'ın kendi kaydı yok, otherMentor'ın kaydı gözükmemeli
    expect((res.body.items as { mentorId: string }[]).every((l) => l.mentorId === mentor.id)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// YÜKSEK-5: submitTemperamentTest — isSelf guard
// ═══════════════════════════════════════════════════════════════════════════

describe('YÜKSEK-5: submitTemperamentTest — isSelf || isAdmin', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let menti: User & { rawPassword: string };
  let otherMenti: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    menti      = await createMenti(tenant.id);
    otherMenti = await createMenti(tenant.id);
  });

  const validAnswers = Array.from({ length: 7 }, (_, i) => ({
    questionId: i + 1,
    selectedDisc: 'D' as const,
  }));

  it('başka mentin testini gönder → 403', async () => {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .post(`/api/users/${otherMenti.id}/temperament-test`)
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ answers: validAnswers });

    expect(res.status).toBe(403);
  });

  it('kendi testini gönder → 200', async () => {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .post(`/api/users/${menti.id}/temperament-test`)
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ answers: validAnswers });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ORTA-2: patchSelfProfile — isSelf guard
// ═══════════════════════════════════════════════════════════════════════════

describe('ORTA-2: patchSelfProfile — isSelf || isAdmin', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
    menti  = await createMenti(tenant.id);
  });

  it('başkasının selfProfile güncelleme → 403', async () => {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .patch(`/api/users/${mentor.id}/self-profile`)
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ hacked: true });

    expect(res.status).toBe(403);
  });

  it('kendi selfProfile güncelleme → 200', async () => {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .patch(`/api/users/${menti.id}/self-profile`)
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ key: 'value' });

    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ORTA-3: createAgreement — taraf kontrolü
// ═══════════════════════════════════════════════════════════════════════════

describe('ORTA-3: createAgreement — taraf kontrolü', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };
  let menti: User & { rawPassword: string };
  let otherMentor: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor      = await createMentor(tenant.id);
    menti       = await createMenti(tenant.id);
    otherMentor = await createMentor(tenant.id);
  });

  const agreementBody = (mentorId: string, mentiId: string) => ({
    mentorId,
    mentiId,
    meetingFrequency:     'WEEKLY',
    communicationChannel: 'ONLINE',
    durationWeeks:        12,
    targetMeetings:       12,
    mentiGoal:            'Bu mentorluk sürecinde kariyer hedeflerimi netleştirmek istiyorum.',
    agendaOwner:          'MENTI',
    privacyAgreed:        true,
  });

  it('taraf olmayan mentor, başkasının çifti için anlaşma oluşturamaz → 403', async () => {
    const { accessToken } = await loginAs(http, otherMentor.email, otherMentor.rawPassword);
    const res = await http
      .post('/api/agreements')
      .set(tenantHeaders(tenant.id, accessToken))
      .send(agreementBody(mentor.id, menti.id));

    expect(res.status).toBe(403);
  });

  it('taraf olan mentor kendi anlaşmasını oluşturabilir → 201', async () => {
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http
      .post('/api/agreements')
      .set(tenantHeaders(tenant.id, accessToken))
      .send(agreementBody(mentor.id, menti.id));

    expect(res.status).toBe(201);
  });
});
