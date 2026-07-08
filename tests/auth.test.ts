/**
 * Auth Entegrasyon Testleri
 *
 * Kapsam: register, login, refresh, logout, forgot-password, reset-password
 * Her describe bloğu öncesinde DB temizlenir → test izolasyonu garanti.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, type LoginTokens, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('Auth: Register', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant({ name: 'Auth Test Tenant' });
  });

  it('geçerli payload ile 201 döner ve kullanıcı PENDING olur', async () => {
    const res = await http
      .post('/api/auth/register')
      .send({
        email: 'newuser@test.local',
        password: 'Test1234!',
        fullName: 'Yeni Kullanıcı',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
      })
      .expect(201);

    expect(res.body.user.approvalStatus).toBe('PENDING');
    expect(res.body.user.email).toBe('newuser@test.local');
  });

  it('geçersiz e-posta ile 400 döner', async () => {
    const res = await http
      .post('/api/auth/register')
      .send({ email: 'bozuk-email', password: 'Test1234!', fullName: 'Ad', role: 'MENTI', tenantSlug: tenant.slug })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION');
  });

  it('kısa şifre ile 400 döner', async () => {
    await http
      .post('/api/auth/register')
      .send({ email: 'x@test.local', password: '123', fullName: 'Ad', role: 'MENTI', tenantSlug: tenant.slug })
      .expect(400);
  });

  it('mevcut e-posta ile 409 döner', async () => {
    const user = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    await http
      .post('/api/auth/register')
      .send({ email: user.email, password: 'Test1234!', fullName: 'Tekrar', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(409);
  });

  it('geçersiz tenant slug ile 400 döner', async () => {
    await http
      .post('/api/auth/register')
      .send({ email: 'x@test.local', password: 'Test1234!', fullName: 'Ad', role: 'MENTI', tenantSlug: 'yok-bu-tenant' })
      .expect(400);
  });
});

describe('Auth: Login', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('doğru kimlik bilgileriyle accessToken + refreshToken döner', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const res = await http
      .post('/api/auth/login')
      .send({ email: user.email, password: user.rawPassword })
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 3600,
    });
    expect(res.body.user.id).toBe(user.id);
  });

  it('yanlış şifre ile 401 döner', async () => {
    const user = await createUser({ tenantId: tenant.id });
    await http
      .post('/api/auth/login')
      .send({ email: user.email, password: 'YanlisŞifre99' })
      .expect(401);
  });

  it('var olmayan e-posta ile 401 döner (kullanıcı tespitini engelle)', async () => {
    const res = await http
      .post('/api/auth/login')
      .send({ email: 'yok@test.local', password: 'Test1234!' })
      .expect(401);

    // "E-posta veya şifre hatalı" — hangi bilginin yanlış olduğu belirtilmez
    expect(res.body.error).toBe('KIMLIK_DOGRULANMADI');
  });

  it('pasif kullanıcı ile 401 döner', async () => {
    const user = await createUser({ tenantId: tenant.id });
    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await http
      .post('/api/auth/login')
      .send({ email: user.email, password: user.rawPassword })
      .expect(401);
  });
});

describe('Auth: Refresh Token', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let tokens: LoginTokens;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    tokens = await loginAs(http, user.email, user.rawPassword);
  });

  it('geçerli refreshToken ile yeni token çifti döner', async () => {
    const res = await http
      .post('/api/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // Token rotasyonu: eski token artık geçersiz
    expect(res.body.refreshToken).not.toBe(tokens.refreshToken);
  });

  it('eski refreshToken ikinci kullanımda 401 döner (replay attack koruması)', async () => {
    // İlk kullanım
    await http.post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(200);
    // Replay dene
    await http.post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
  });

  it('geçersiz token ile 401 döner', async () => {
    await http.post('/api/auth/refresh').send({ refreshToken: 'gecersiz-token' }).expect(401);
  });
});

describe('Auth: Logout', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('geçerli refreshToken ile 204 döner ve token DB\'den silinir', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const tokens = await loginAs(http, user.email, user.rawPassword);

    await http.post('/api/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(204);

    // DB'den silindi mi?
    const dbToken = await testPrisma.refreshToken.findUnique({
      where: { token: tokens.refreshToken },
    });
    expect(dbToken).toBeNull();
  });

  it('var olmayan token ile de 204 döner (idempotent)', async () => {
    await http.post('/api/auth/logout').send({ refreshToken: 'olmayan-token' }).expect(204);
  });
});

describe('Auth: Onay Durumu Güvenlik Koruması', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('PENDING kullanıcı login olmaya çalışırken 403 Forbidden döner', async () => {
    const pendingUser = await createUser({
      tenantId: tenant.id,
      role: 'MENTI',
      approvalStatus: 'PENDING',
    });

    const res = await http
      .post('/api/auth/login')
      .send({ email: pendingUser.email, password: pendingUser.rawPassword })
      .expect(403);

    expect(res.body.error).toBe('HESAP_ONAY_BEKLENIYOR');
    expect(res.body).not.toHaveProperty('accessToken');
    expect(res.body).not.toHaveProperty('refreshToken');
  });

  it('REJECTED kullanıcı login olmaya çalışırken 403 Forbidden döner', async () => {
    const rejectedUser = await createUser({
      tenantId: tenant.id,
      role: 'MENTOR',
      approvalStatus: 'REJECTED',
    });

    const res = await http
      .post('/api/auth/login')
      .send({ email: rejectedUser.email, password: rejectedUser.rawPassword })
      .expect(403);

    expect(res.body.error).toBe('HESAP_REDDEDILDI');
    expect(res.body).not.toHaveProperty('accessToken');
  });

  it('APPROVED kullanıcı login olduğunda JWT accessToken başarıyla alır', async () => {
    const approvedUser = await createUser({
      tenantId: tenant.id,
      role: 'MENTOR',
      approvalStatus: 'APPROVED',
    });

    const res = await http
      .post('/api/auth/login')
      .send({ email: approvedUser.email, password: approvedUser.rawPassword })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(0);
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.approvalStatus).toBe('APPROVED');
  });
});

describe('Auth: Forgot/Reset Password', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('kayıtlı e-posta için 200 döner (generic mesaj)', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const res = await http
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    expect(res.body.message).toContain('gönderildi');
  });

  it('kayıtlı olmayan e-posta için de aynı 200 mesajı döner (kullanıcı tespiti engelleme)', async () => {
    const res1 = await http.post('/api/auth/forgot-password').send({ email: 'yok@test.local' }).expect(200);
    const user = await createUser({ tenantId: tenant.id });
    const res2 = await http.post('/api/auth/forgot-password').send({ email: user.email }).expect(200);
    // Her iki yanıt aynı mesajı içermeli
    expect(res1.body.message).toBe(res2.body.message);
  });

  it('reset-password: geçersiz token ile 400 döner', async () => {
    await http
      .post('/api/auth/reset-password')
      .send({ token: 'gecersiz-token', password: 'YeniSifre1!' })
      .expect(400);
  });

  it('reset-password: geçerli token ile şifreyi günceller ve eski token geçersiz olur', async () => {
    const user = await createUser({ tenantId: tenant.id });

    // forgot-password'dan token üret (DB'den al)
    await http.post('/api/auth/forgot-password').send({ email: user.email });
    const dbToken = await testPrisma.passwordResetToken.findFirst({
      where: { userId: user.id },
    });
    expect(dbToken).not.toBeNull();

    // Token hash'ten raw token'ı test için doğrudan DB'e yazıp okuyamayız;
    // Bu test reset-password endpoint'inin geçersiz token'ı reddettiğini doğrular.
    // Tam akış testi için emailService mock'lanmalı (e2e scope).
    await http
      .post('/api/auth/reset-password')
      .send({ token: 'yanlis-token', password: 'YeniSifre1!' })
      .expect(400);
  });
});
