/**
 * GV-19 — oturum içi şifre değiştirme + şifre kuralının kayıt/sıfırlama/self-serve'de uygulanması.
 *
 * POST /api/auth/change-password: kimlik oturumdan (req.auth); mevcut şifre bcrypt ile doğrulanır;
 * başarıda diğer oturumlar düşer, isteği yapan oturum korunur (komşu uç resetPassword ile aynı
 * hash + oturum düşürme mantığı).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { Tenant, User } from '@prisma/client';

const NEW_PASSWORD = 'YeniSifre2026';

describe('GV-19: POST /api/auth/change-password', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let user: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    user = await createUser({ tenantId: tenant.id });
  });

  function changePassword(
    client: TestAgent,
    accessToken: string | undefined,
    body: Record<string, unknown>,
  ) {
    return client
      .post('/api/auth/change-password')
      .set(tenantHeaders(tenant.id, accessToken))
      .send(body);
  }

  it('başarılı değiştirme → 200; yeni şifreyle giriş olur, eskisiyle olmaz; yanıtta şifre/hash yok', async () => {
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    const res = await changePassword(http, accessToken, {
      currentPassword: user.rawPassword,
      newPassword: NEW_PASSWORD,
    }).expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain('$2');
    expect(res.body.password).toBeUndefined();

    await agent().post('/api/auth/login').send({ email: user.email, password: NEW_PASSWORD }).expect(200);
    await agent().post('/api/auth/login').send({ email: user.email, password: user.rawPassword }).expect(401);
  });

  it('yanlış mevcut şifre → 400 MEVCUT_SIFRE_HATALI ve şifre DEĞİŞMEZ (DB)', async () => {
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    const res = await changePassword(http, accessToken, {
      currentPassword: 'YanlisSifre99',
      newPassword: NEW_PASSWORD,
    }).expect(400);
    expect(res.body.error).toBe('MEVCUT_SIFRE_HATALI');

    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    expect(after.password).toBe(before.password);
    expect(await bcrypt.compare(user.rawPassword, after.password!)).toBe(true);
  });

  it('kimliksiz istek → 401', async () => {
    await changePassword(http, undefined, {
      currentPassword: user.rawPassword,
      newPassword: NEW_PASSWORD,
    }).expect(401);
  });

  it.each(['12345678', 'abcdefgh', 'kisa1'])('zayıf yeni şifre (%s) → 400 VALIDATION, şifre değişmez', async (weak) => {
    const before = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    const res = await changePassword(http, accessToken, {
      currentPassword: user.rawPassword,
      newPassword: weak,
    }).expect(400);
    expect(res.body.error).toBe('VALIDATION');

    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    expect(after.password).toBe(before.password);
  });

  it('yeni şifre mevcut şifreyle aynıysa → 400 SIFRE_AYNI', async () => {
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);
    const res = await changePassword(http, accessToken, {
      currentPassword: user.rawPassword,
      newPassword: user.rawPassword,
    }).expect(400);
    expect(res.body.error).toBe('SIFRE_AYNI');
  });

  it('diğer cihazın refresh token\'ı silinir, isteği yapan oturum korunur', async () => {
    const otherDevice = agent();
    await loginAs(otherDevice, user.email, user.rawPassword);
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(2);

    const res = await changePassword(http, accessToken, {
      currentPassword: user.rawPassword,
      newPassword: NEW_PASSWORD,
    }).expect(200);
    expect(res.body.currentSessionKept).toBe(true);
    expect(res.body.revokedSessions).toBe(1);

    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
    await otherDevice.post('/api/auth/refresh').expect(401);
    await http.post('/api/auth/refresh').expect(200);
  });

  it('refresh çerezi yoksa tüm oturumlar düşer ve yanıtta belirtilir', async () => {
    const otherDevice = agent();
    await loginAs(otherDevice, user.email, user.rawPassword);
    const accessToken = signToken({ sub: user.id, tenantId: tenant.id, role: user.role, fullName: user.fullName });

    const res = await changePassword(agent(), accessToken, {
      currentPassword: user.rawPassword,
      newPassword: NEW_PASSWORD,
    }).expect(200);
    expect(res.body.currentSessionKept).toBe(false);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('OAuth hesabı (şifresi yok) → 409 SIFRE_DEGISTIRILEMEZ', async () => {
    await testPrisma.user.update({ where: { id: user.id }, data: { authProvider: 'GOOGLE', password: null } });
    const accessToken = signToken({ sub: user.id, tenantId: tenant.id, role: user.role, fullName: user.fullName });

    const res = await changePassword(http, accessToken, {
      currentPassword: 'HerhangiBir1',
      newPassword: NEW_PASSWORD,
    }).expect(409);
    expect(res.body.error).toBe('SIFRE_DEGISTIRILEMEZ');

    const after = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { password: true } });
    expect(after.password).toBeNull();
  });

  it('kimlik gövdeden alınmaz: gövdedeki userId başka kullanıcının şifresini değiştirmez', async () => {
    const victim = await createUser({ tenantId: tenant.id });
    const victimBefore = await testPrisma.user.findUniqueOrThrow({ where: { id: victim.id }, select: { password: true } });
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);

    await changePassword(http, accessToken, {
      userId: victim.id,
      currentPassword: user.rawPassword,
      newPassword: NEW_PASSWORD,
    }).expect(200);

    const victimAfter = await testPrisma.user.findUniqueOrThrow({ where: { id: victim.id }, select: { password: true } });
    expect(victimAfter.password).toBe(victimBefore.password);
  });
});

describe('GV-19: şifre kuralı kayıt / sıfırlama / self-serve kayıtta uygulanır', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it.each(['12345678', 'abcdefgh'])('register: zayıf şifre (%s) → 400 VALIDATION, kullanıcı oluşmaz', async (weak) => {
    const email = `weak-${Date.now()}@test.local`;
    const res = await http
      .post('/api/auth/register')
      .send({ email, password: weak, fullName: 'Zayif Sifre', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION');
    expect(await testPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('reset-password: zayıf şifre token kontrolünden ÖNCE 400 VALIDATION döner', async () => {
    const res = await http
      .post('/api/auth/reset-password')
      .send({ token: 'herhangi-bir-token', password: '12345678' })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('self-serve kurum kaydı: zayıf şifre → 400 VALIDATION', async () => {
    const stamp = Date.now();
    const res = await http
      .post('/api/tenants/self-serve/register')
      .send({
        email: `stk-${stamp}@test.local`,
        password: 'abcdefgh',
        name: 'Kurucu Admin',
        tenantName: 'Test STK',
        slug: `stk-${stamp}`,
        programTemplate: 'OZEL',
        kvkkConsent: true,
      })
      .expect(400);
    expect(res.body.error).toBe('VALIDATION');
  });
});
