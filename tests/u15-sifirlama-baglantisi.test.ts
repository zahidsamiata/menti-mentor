/**
 * U-15 (KARAR-84 B) — e-posta çalışmazsa şifre sıfırlama bağlantısını YALNIZ platform yöneticisi üretir;
 * her üretim iz kaydına yazılır. Bağlantı e-posta akışıyla aynı tokendır (60 dk, tek kullanımlık).
 *
 * Ölçüt: platform yöneticisi bağlantı üretir → kişi bağlantıyla yeni şifre koyup girer.
 * NEGATİF: kurum yöneticisi / kullanıcı üretemez (403) ve token oluşmaz · başka kurumun kişisi 404.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

function platformCookie(token?: string): string {
  const t = token ?? signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(t)}`;
}

const path = (tenantId: string, userId: string) => `/api/platform/tenants/${tenantId}/users/${userId}/password-reset-link`;

describe('U-15: platform yöneticisi şifre sıfırlama bağlantısı', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('platform yöneticisi bağlantı üretir; kişi bağlantıyla yeni şifre koyup giriş yapar', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);

    const res = await http.post(path(tenant.id, menti.id)).set('Cookie', platformCookie());
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.expiresInMinutes).toBe(60);
    const url = new URL(res.body.resetUrl as string);
    expect(url.pathname).toBe('/reset-password');
    const token = url.searchParams.get('token')!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // DB'de ham token değil yalnız özeti durur.
    const stored = await testPrisma.passwordResetToken.findMany({ where: { userId: menti.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(token);

    await http.post('/api/auth/reset-password').send({ token, password: 'Yeni-Sifre-2026!' }).expect(200);
    await http.post('/api/auth/login').send({ email: menti.email, password: 'Yeni-Sifre-2026!' }).expect(200);
    // tek kullanımlık
    await http.post('/api/auth/reset-password').send({ token, password: 'Baska-Sifre-2026!' }).expect(400);
  });

  it('her üretim iz kaydına yazılır (token ve e-posta olmadan)', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);
    const res = await http.post(path(tenant.id, menti.id)).set('Cookie', platformCookie()).expect(201);

    const logs = await testPrisma.systemLog.findMany({ where: { category: 'AUDIT', message: 'ISSUE_PASSWORD_RESET_LINK' } });
    expect(logs).toHaveLength(1);
    const meta = JSON.stringify(logs[0]!.meta);
    expect(meta).toContain(menti.id);
    expect(meta).toContain(tenant.id);
    expect(meta).not.toContain(menti.email);
    expect(meta).not.toContain(new URL(res.body.resetUrl as string).searchParams.get('token')!);
  });

  it('NEGATİF: kurum yöneticisi (platform yetkisi yok) üretemez — 403, token oluşmaz', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);
    const admin = await createAdminUser(tenant.id);
    const tenantAdminToken = signToken({ sub: admin.id, tenantId: tenant.id, role: 'ADMIN', fullName: admin.fullName });

    const viaCookie = await http.post(path(tenant.id, menti.id)).set('Cookie', platformCookie(tenantAdminToken));
    expect(viaCookie.status).toBe(403);
    const viaBearer = await http.post(path(tenant.id, menti.id)).set(tenantHeaders(tenant.id, tenantAdminToken));
    expect([401, 403]).toContain(viaBearer.status);

    expect(await testPrisma.passwordResetToken.count({ where: { userId: menti.id } })).toBe(0);
  });

  it('NEGATİF: kullanıcı kendisi için de üretemez — 403/401, token oluşmaz', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);
    const own = signToken({ sub: menti.id, tenantId: tenant.id, role: 'MENTI', fullName: menti.fullName });
    const res = await http.post(path(tenant.id, menti.id)).set('Cookie', platformCookie(own));
    expect([401, 403]).toContain(res.status);
    expect(await testPrisma.passwordResetToken.count({ where: { userId: menti.id } })).toBe(0);
  });

  it('NEGATİF: başka kurumun kişisi bu kurum yolundan → 404, token oluşmaz', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const mentiOfB = await createMenti(tenantB.id);
    await http.post(path(tenantA.id, mentiOfB.id)).set('Cookie', platformCookie()).expect(404);
    expect(await testPrisma.passwordResetToken.count({ where: { userId: mentiOfB.id } })).toBe(0);
  });

  it('Google/LinkedIn ile giren kişiye bağlantı üretilmez (409)', async () => {
    const tenant = await createTenant();
    const menti = await createMenti(tenant.id);
    await testPrisma.user.update({ where: { id: menti.id }, data: { authProvider: 'GOOGLE' } });
    const res = await http.post(path(tenant.id, menti.id)).set('Cookie', platformCookie());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SOSYAL_GIRIS');
  });
});
