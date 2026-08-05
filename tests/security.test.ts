/**
 * Güvenlik Açığı Kapama Testleri — DevSecOps Denetimi
 *
 * KRİTİK-1: GET /users/:id auth guard + password hash sızıntısı
 * KRİTİK-2: GET /api/system-logs platform admin zorunlu + cross-tenant engeli
 */

import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import cors from 'cors';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant, createMentor } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import systemLogRoutes from '../src/routes/systemLogRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import type { Tenant, User } from '@prisma/client';

// ─── Test app: sadece system-log route'unu içerir ────────────────────────────
function createSystemLogTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cors());
  app.use('/api/system-logs', systemLogRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return app;
}

const sysHttp = supertest(createSystemLogTestApp());

// ─── KRİTİK-1: GET /users/:id ────────────────────────────────────────────────

describe('KRİTİK-1a: GET /users/:id — auth guard', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
  });

  it('auth olmadan GET /users/:id → 401', async () => {
    const res = await http
      .get(`/api/users/${mentor.id}`)
      .set({ 'X-Tenant-Id': tenant.id });
    expect(res.status).toBe(401);
  });

  it('auth ile GET /users/:id → 200', async () => {
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http
      .get(`/api/users/${mentor.id}`)
      .set(tenantHeaders(tenant.id, accessToken));
    expect(res.status).toBe(200);
  });
});

describe('KRİTİK-1b: GET /users/:id — password hash hiçbir zaman dönmez', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
  });

  it('başarılı response\'da password alanı YOK', async () => {
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http
      .get(`/api/users/${mentor.id}`)
      .set(tenantHeaders(tenant.id, accessToken));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('authProvider');
  });

  it('id ve email alanları döner (temel profil verisi mevcut)', async () => {
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http
      .get(`/api/users/${mentor.id}`)
      .set(tenantHeaders(tenant.id, accessToken));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('id', mentor.id);
    expect(body).toHaveProperty('email');
  });
});

describe('KRİTİK-1c: GET /users/:userId/clubs — auth guard', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentor: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    mentor = await createMentor(tenant.id);
  });

  it('auth olmadan GET /users/:userId/clubs → 401', async () => {
    const res = await http
      .get(`/api/users/${mentor.id}/clubs`)
      .set({ 'X-Tenant-Id': tenant.id });
    expect(res.status).toBe(401);
  });

  it('auth ile GET /users/:userId/clubs → 200 (boş liste)', async () => {
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http
      .get(`/api/users/${mentor.id}/clubs`)
      .set(tenantHeaders(tenant.id, accessToken));
    expect(res.status).toBe(200);
  });
});

// ─── KRİTİK-2: GET /api/system-logs ─────────────────────────────────────────

// requirePlatformAdmin cookie okur (Bearer değil) — token cookie olarak gönderilmeli.
function sysCookie(token: string): string {
  return `platform_token=${encodeURIComponent(token)}`;
}

describe('KRİTİK-2: GET /api/system-logs — platform admin zorunlu', () => {
  it('auth olmadan → 401', async () => {
    const res = await sysHttp.get('/api/system-logs');
    expect(res.status).toBe(401);
  });

  it('tenant ADMIN JWT ile → 403 (platform admin değil)', async () => {
    const tenantAdminToken = signToken({
      sub: 'some-tenant-admin-id',
      tenantId: 'some-tenant-id',
      role: 'ADMIN',
      fullName: 'Tenant Admin',
    });
    const res = await sysHttp
      .get('/api/system-logs')
      .set('Cookie', sysCookie(tenantAdminToken));
    expect(res.status).toBe(403);
  });

  it('tenant MENTOR JWT ile → 403', async () => {
    const mentorToken = signToken({
      sub: 'some-mentor-id',
      tenantId: 'some-tenant-id',
      role: 'MENTOR',
      fullName: 'Mentor',
    });
    const res = await sysHttp
      .get('/api/system-logs')
      .set('Cookie', sysCookie(mentorToken));
    expect(res.status).toBe(403);
  });

  it('platform admin token ile → 200', async () => {
    const platformToken = signToken(
      {
        sub: 'platform-admin',
        tenantId: '__platform__',
        role: 'ADMIN',
        fullName: 'Platform Yöneticisi',
        isPlatformAdmin: true,
      },
      { audience: PLATFORM_AUDIENCE },
    );
    const res = await sysHttp
      .get('/api/system-logs')
      .set('Cookie', sysCookie(platformToken));
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { items: unknown[] }).items)).toBe(true);
  });
});
