/**
 * KRİTİK-3 Yetkilendirme Testleri
 *
 * - tenantRoutes CRUD → requirePlatformAdmin (platform admin zorunlu)
 * - questionRoutes respond/my-responses/list → requireAuth() (route seviyesi)
 * - Kasıtlı public akışlar bozulmadı (self-serve/check-slug, unsubscribe, auth/login)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { Tenant } from '@prisma/client';

// ─── KRİTİK-3a: tenantRoutes CRUD — platform admin guard ─────────────────────

describe('KRİTİK-3a: tenantRoutes — platform admin zorunlu', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('GET /api/tenants/ auth olmadan → 401', async () => {
    const res = await http.get('/api/tenants/');
    expect(res.status).toBe(401);
  });

  it('POST /api/tenants/ auth olmadan → 401', async () => {
    const res = await http
      .post('/api/tenants/')
      .send({ name: 'Test', slug: 'test-slug-1' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/tenants/:id auth olmadan → 401', async () => {
    const res = await http.patch('/api/tenants/some-id').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('GET /api/tenants/:id auth olmadan → 401', async () => {
    const res = await http.get('/api/tenants/some-id');
    expect(res.status).toBe(401);
  });

  it('tenant ADMIN JWT ile GET /api/tenants/ → 403 (platform admin değil)', async () => {
    const tenantAdminToken = signToken({
      sub: 'admin-id',
      tenantId: 'some-tenant',
      role: 'ADMIN',
      fullName: 'Admin',
    });
    const res = await http
      .get('/api/tenants/')
      .set('Authorization', `Bearer ${tenantAdminToken}`);
    expect(res.status).toBe(403);
  });

  it('tenant MENTI JWT ile POST /api/tenants/ → 403', async () => {
    const mentiToken = signToken({
      sub: 'menti-id',
      tenantId: 'some-tenant',
      role: 'MENTI',
      fullName: 'Menti',
    });
    const res = await http
      .post('/api/tenants/')
      .set('Authorization', `Bearer ${mentiToken}`)
      .send({ name: 'X', slug: 'x' });
    expect(res.status).toBe(403);
  });

  it('platform admin ile GET /api/tenants/ → 200', async () => {
    const platformToken = signToken({
      sub: 'platform-admin',
      tenantId: '__platform__',
      role: 'ADMIN',
      fullName: 'Platform Yöneticisi',
      isPlatformAdmin: true,
    });
    const res = await http
      .get('/api/tenants/')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { items: unknown[] }).items)).toBe(true);
  });

  it('platform admin ile POST /api/tenants/ → 201', async () => {
    const platformToken = signToken({
      sub: 'platform-admin',
      tenantId: '__platform__',
      role: 'ADMIN',
      fullName: 'Platform Yöneticisi',
      isPlatformAdmin: true,
    });
    const slug = `test-tenant-${Date.now()}`;
    const res = await http
      .post('/api/tenants/')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Yeni Tenant', slug });
    expect(res.status).toBe(201);
    expect((res.body as { slug: string }).slug).toBe(slug);
  });
});

// ─── KRİTİK-3b: questionRoutes — route-level auth guard ──────────────────────

describe('KRİTİK-3b: questionRoutes — route seviyesi auth guard', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('GET /api/questions auth olmadan → 401', async () => {
    const res = await http
      .get('/api/questions')
      .set({ 'X-Tenant-Id': tenant.id });
    expect(res.status).toBe(401);
  });

  it('GET /api/questions/my-responses auth olmadan → 401', async () => {
    const res = await http
      .get('/api/questions/my-responses')
      .set({ 'X-Tenant-Id': tenant.id });
    expect(res.status).toBe(401);
  });

  it('POST /api/questions/respond auth olmadan → 401', async () => {
    const res = await http
      .post('/api/questions/respond')
      .set({ 'X-Tenant-Id': tenant.id })
      .send({ responses: [{ questionId: 'q1', value: 3 }] });
    expect(res.status).toBe(401);
  });

  it('POST /api/questions/:questionId/respond auth olmadan → 401', async () => {
    const res = await http
      .post('/api/questions/fake-question-id/respond')
      .set({ 'X-Tenant-Id': tenant.id })
      .send({ value: 3 });
    expect(res.status).toBe(401);
  });
});

// ─── Public akışlar bozulmadı ─────────────────────────────────────────────────

describe('Public akışlar — auth gerektirmeyen endpointler hâlâ çalışıyor', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('GET /api/tenants/self-serve/check-slug → 401/403 DEĞİL (self-serve public)', async () => {
    const res = await http.get('/api/tenants/self-serve/check-slug?slug=test-abc');
    // selfServeRoutes platformAdmin gerektirmiyor — 200 veya başka bir iş hatası döner
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('GET /api/tenants/unsubscribe → 401/403 DEĞİL (token-based public)', async () => {
    const res = await http.get('/api/tenants/unsubscribe?token=invalid-token');
    // Geçersiz token olsa bile auth hatası dönemez
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('POST /api/auth/login geçersiz kimlik → kimlik hatası, auth middleware hatası değil', async () => {
    const res = await http
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'wrong' });
    expect(res.status).toBe(401);
    // Login 401'i auth middleware'den değil controller'dan gelmeli
    expect((res.body as { error: string }).error).toBe('KIMLIK_DOGRULANMADI');
  });

  it('GET /health → her zaman 200 (auth yok)', async () => {
    const res = await http.get('/health');
    expect(res.status).toBe(200);
  });
});
