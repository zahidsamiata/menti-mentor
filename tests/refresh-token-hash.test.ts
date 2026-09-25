/**
 * GV-13 — refresh token veritabanında özetli (SHA-256) saklanır.
 *
 * İddialar:
 *  - Girişte yazılan kayıt özettir; çerezdeki ham değer veritabanında YOK.
 *  - Refresh ham çerezle çalışır; rotasyonla yazılan yeni kayıt da özettir.
 *  - Geçiş: bu değişiklikten önce yazılmış AÇIK METİN kayıtla refresh çalışır ve kayıt
 *    özetli yeni kayda dönüşür (kullanıcı zorla çıkış yapmaz).
 *  - Logout hem özetli hem eski açık-metin kaydı siler.
 *  - Hesap kapatma kullanıcının TÜM refresh kayıtlarını siler.
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Tenant } from '@prisma/client';
import { agent, loginAs, tenantHeaders } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { hashRefreshToken } from '../src/services/refreshToken.js';

const COOKIE = 'mm_refresh';

/** Set-Cookie başlığından ham refresh değerini çıkarır. */
function rawRefreshFrom(res: { headers: Record<string, unknown> }): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[] | undefined) ?? []);
  const c = cookies.find((x) => x.startsWith(`${COOKIE}=`));
  expect(c).toBeDefined();
  return decodeURIComponent(c!.split(';')[0].slice(COOKIE.length + 1));
}

async function seedLegacyToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(64).toString('hex');
  await testPrisma.refreshToken.create({
    data: { token: raw, userId, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return raw;
}

describe('GV-13: refresh token özetli saklama', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('giriş: DB\'de özet var, ham çerez değeri DB\'de YOK', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const res = await agent().post('/api/auth/login').send({ email: user.email, password: user.rawPassword }).expect(200);
    const raw = rawRefreshFrom(res);

    expect(await testPrisma.refreshToken.findUnique({ where: { token: raw } })).toBeNull();
    const rows = await testPrisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(hashRefreshToken(raw));
  });

  it('refresh: ham çerezle çalışır, rotasyonla yazılan yeni kayıt da özet', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const http = agent();
    await loginAs(http, user.email, user.rawPassword);

    const res = await http.post('/api/auth/refresh').expect(200);
    expect(res.body.accessToken).toBeDefined();
    const newRaw = rawRefreshFrom(res);

    const rows = await testPrisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(hashRefreshToken(newRaw));
    expect(await testPrisma.refreshToken.findUnique({ where: { token: newRaw } })).toBeNull();
  });

  it('refresh: yalnız ham çerez değeri kabul edilir; DB\'de saklanan değer çerez yerine geçmez (401)', async () => {
    const user = await createUser({ tenantId: tenant.id });
    await agent().post('/api/auth/login').send({ email: user.email, password: user.rawPassword }).expect(200);
    const row = await testPrisma.refreshToken.findFirst({ where: { userId: user.id } });

    await agent().post('/api/auth/refresh').set('Cookie', `${COOKIE}=${row!.token}`).expect(401);
    // Kayıt yerinde (geçersiz istek meşru oturumu düşürmez)
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it('geçiş: eski açık-metin kayıtla refresh çalışır ve kayıt özetli yeni kayda dönüşür', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const legacyRaw = await seedLegacyToken(user.id);

    const res = await agent().post('/api/auth/refresh').set('Cookie', `${COOKIE}=${legacyRaw}`).expect(200);
    expect(res.body.accessToken).toBeDefined();
    const newRaw = rawRefreshFrom(res);

    expect(await testPrisma.refreshToken.findUnique({ where: { token: legacyRaw } })).toBeNull();
    const rows = await testPrisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].token).toBe(hashRefreshToken(newRaw));

    // Eski ham değer rotasyondan sonra tekrar kullanılamaz
    await agent().post('/api/auth/refresh').set('Cookie', `${COOKIE}=${legacyRaw}`).expect(401);
  });

  it('logout: özetli kaydı siler', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const http = agent();
    await loginAs(http, user.email, user.rawPassword);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(1);

    await http.post('/api/auth/logout').expect(204);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('logout: eski açık-metin kaydı siler', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const legacyRaw = await seedLegacyToken(user.id);

    await agent().post('/api/auth/logout').set('Cookie', `${COOKIE}=${legacyRaw}`).expect(204);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('hesap kapatma: özetli + eski açık-metin TÜM kayıtlar silinir', async () => {
    const user = await createUser({ tenantId: tenant.id, role: 'MENTOR' });
    const http = agent();
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);
    await seedLegacyToken(user.id);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(2);

    await http
      .post('/api/me/delete-account')
      .set(tenantHeaders(tenant.id, accessToken))
      .send({ confirmEmail: user.email })
      .expect(200);
    expect(await testPrisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
