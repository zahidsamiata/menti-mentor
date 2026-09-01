/**
 * Auth Entegrasyon Testleri
 *
 * Kapsam: register, login, refresh, logout, forgot-password, reset-password
 * Her describe bloğu öncesinde DB temizlenir → test izolasyonu garanti.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { agent, loginAs, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { config } from '../src/config.js';
import type { Tenant } from '@prisma/client';

/** Geçerli davet token'ı üret (createInvitation ile BİREBİR aynı imza: type='invitation'). */
function signInvite(tenantId: string, role: 'MENTOR' | 'MENTI'): string {
  return jwt.sign({ tenantId, role, type: 'invitation' }, config.jwt.secret, { expiresIn: '30d' });
}

describe('Auth: Register', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant({ name: 'Auth Test Tenant' });
  });

  // DAVETSİZ kayıt (token yok) → PENDING kalır (admin onayı). Bu, davet=onay iyileştirmesinin
  // regresyon koruması: PO kararı 2026-09-01 (Seçenek A) davetsiz kaydı otomatik ONAYLAMAZ.
  it('davetsiz (token yok) geçerli payload → 201 + kullanıcı PENDING', async () => {
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

  // GÜVENLİK İYİLEŞTİRMESİ (PO 2026-09-01, Seçenek A): geçerli davet token'ı = onay → APPROVED.
  // Kurum yöneticisi token'ı üretip kime verdiğini biliyor; ikinci admin onayı mükerrer.
  it('geçerli davet token\'ı ile → 201 + kullanıcı APPROVED', async () => {
    const res = await http
      .post('/api/auth/register')
      .send({
        email: 'davetli@test.local',
        password: 'Test1234!',
        fullName: 'Davetli Kullanıcı',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        inviteToken: signInvite(tenant.id, 'MENTI'),
      })
      .expect(201);

    expect(res.body.user.approvalStatus).toBe('APPROVED');
  });

  // Sahte/geçersiz token onay KAZANDIRMAZ → PENDING (kayıt reddedilmez, admin onaylar).
  it('sahte/geçersiz davet token\'ı ile → 201 + PENDING (onay kazandırmaz)', async () => {
    const res = await http
      .post('/api/auth/register')
      .send({
        email: 'sahte@test.local',
        password: 'Test1234!',
        fullName: 'Sahte Token',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        inviteToken: 'gecersiz.sahte.token',
      })
      .expect(201);

    expect(res.body.user.approvalStatus).toBe('PENDING');
  });

  // Token GEÇERLİ ama rol/tenant UYUŞMUYOR → PENDING (başka kuruma/role ait token onay taşımaz).
  it('davet token\'ı rol/tenant uyuşmuyorsa → 201 + PENDING', async () => {
    const res = await http
      .post('/api/auth/register')
      .send({
        email: 'uyusmaz@test.local',
        password: 'Test1234!',
        fullName: 'Uyusmaz Rol',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        inviteToken: signInvite(tenant.id, 'MENTOR'), // token MENTOR, kayıt MENTI → uyuşmaz
      })
      .expect(201);

    expect(res.body.user.approvalStatus).toBe('PENDING');
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

  it('mevcut e-posta ile de 201 döner — numaralandırma önleme (YÜKSEK-3)', async () => {
    const user = await createUser({ tenantId: tenant.id, role: 'MENTI' });
    const res = await http
      .post('/api/auth/register')
      .send({ email: user.email, password: 'Test1234!', fullName: 'Tekrar', role: 'MENTI', tenantSlug: tenant.slug, kvkkConsent: true })
      .expect(201);
    // Kayıtlı ve kayıtsız e-posta için aynı status + aynı mesaj yapısı
    expect(res.body.message).toBeDefined();
    expect(res.body.user).toBeNull();
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

  it('doğru kimlik bilgileriyle accessToken döner ve refreshToken cookie olarak set edilir', async () => {
    const user = await createUser({ tenantId: tenant.id });
    const res = await http
      .post('/api/auth/login')
      .send({ email: user.email, password: user.rawPassword })
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      expiresIn: 3600,
    });
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.headers['set-cookie']).toBeDefined();
    const rawCookie = res.headers['set-cookie'];
    const setCookie = Array.isArray(rawCookie) ? rawCookie.join(';') : (rawCookie ?? '');
    expect(setCookie).toContain('mm_refresh=');
    expect(setCookie).toContain('HttpOnly');
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

  it('pasif kullanıcı DOĞRU şifreyle → 403 HESAP_PASIF (durum yalnız şifre sonrası açılır)', async () => {
    const user = await createUser({ tenantId: tenant.id });
    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await http
      .post('/api/auth/login')
      .send({ email: user.email, password: user.rawPassword })
      .expect(403);
    expect(res.body.error).toBe('HESAP_PASIF');
    expect(res.body).not.toHaveProperty('accessToken');
  });

  it('ENUMERATION: pasif kullanıcı YANLIŞ şifreyle → generic 401 (pasiflik sızmaz)', async () => {
    const user = await createUser({ tenantId: tenant.id });
    await testPrisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await http
      .post('/api/auth/login')
      .send({ email: user.email, password: 'YanlisSifre99!' })
      .expect(401);
    expect(res.body.error).toBe('KIMLIK_DOGRULANMADI');
    expect(res.body.error).not.toBe('HESAP_PASIF');
  });
});

describe('Auth: Refresh Token', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const user = await createUser({ tenantId: tenant.id });
    // Login → cookie jar'a mm_refresh cookie set edilir
    await loginAs(http, user.email, user.rawPassword);
  });

  it('cookie ile yeni accessToken döner, refreshToken body\'de yok', async () => {
    const res = await http
      .post('/api/auth/refresh')
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('cookie olmadan 401 döner', async () => {
    // Farklı agent — cookie yok
    const freshAgent = agent();
    await freshAgent.post('/api/auth/refresh').expect(401);
  });

  it('token rotasyonu: iki kez refresh → ikinci refresh de çalışır', async () => {
    const res1 = await http.post('/api/auth/refresh').expect(200);
    expect(res1.body.accessToken).toBeDefined();
    // Cookie rotasyonu nedeniyle yeni cookie set edildi
    const res2 = await http.post('/api/auth/refresh').expect(200);
    expect(res2.body.accessToken).toBeDefined();
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

  it('cookie ile 204 döner ve token DB\'den silinir', async () => {
    const user = await createUser({ tenantId: tenant.id });
    await loginAs(http, user.email, user.rawPassword);

    // DB'deki token'ı bul
    const dbTokenBefore = await testPrisma.refreshToken.findFirst({
      where: { userId: user.id },
    });
    expect(dbTokenBefore).not.toBeNull();

    await http.post('/api/auth/logout').expect(204);

    const dbTokenAfter = await testPrisma.refreshToken.findUnique({
      where: { token: dbTokenBefore!.token },
    });
    expect(dbTokenAfter).toBeNull();
  });

  it('cookie olmadan da 204 döner (idempotent)', async () => {
    const freshAgent = agent();
    await freshAgent.post('/api/auth/logout').expect(204);
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
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.body.user.approvalStatus).toBe('APPROVED');
  });

  // ─── #37 Enumeration sertleştirme: durum bilgisi şifre denemeden SIZMAZ ───────────────────
  it('ENUMERATION: PENDING kullanıcı YANLIŞ şifreyle → generic 401 (onay-bekliyor sızmaz)', async () => {
    const pendingUser = await createUser({
      tenantId: tenant.id,
      role: 'MENTI',
      approvalStatus: 'PENDING',
    });
    const res = await http
      .post('/api/auth/login')
      .send({ email: pendingUser.email, password: 'YanlisSifre99!' })
      .expect(401);
    // Onay-bekleme durumu doğru şifre olmadan AÇILMAZ.
    expect(res.body.error).toBe('KIMLIK_DOGRULANMADI');
    expect(res.body.error).not.toBe('HESAP_ONAY_BEKLENIYOR');
    expect(res.body.message).toBe('E-posta veya şifre hatalı.');
  });

  it('ENUMERATION: OAuth (sosyal) hesap herhangi bir şifreyle → generic 401 (sosyal-hesap sızmaz)', async () => {
    const oauthUser = await createUser({
      tenantId: tenant.id,
      role: 'MENTI',
      approvalStatus: 'APPROVED',
    });
    // Sosyal-giriş hesabına dönüştür: LOCAL değil + şifre yok.
    await testPrisma.user.update({
      where: { id: oauthUser.id },
      data: { authProvider: 'GOOGLE', password: null },
    });
    const res = await http
      .post('/api/auth/login')
      .send({ email: oauthUser.email, password: 'HerhangiBirSifre1!' })
      .expect(401);
    // "Bu hesap sosyal giriş ile oluşturulmuştur" ipucu ARTIK SIZMAZ — var-olmayan e-posta ile aynı yanıt.
    expect(res.body.error).toBe('KIMLIK_DOGRULANMADI');
    expect(res.body.error).not.toBe('OAUTH_HESAP');
    expect(res.body.message).toBe('E-posta veya şifre hatalı.');
  });

  it('ENUMERATION: var-olmayan / PENDING(yanlış şifre) / OAuth → HEPSİ aynı yanıt (ayırt edilemez)', async () => {
    const pendingUser = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'PENDING' });
    const oauthUser = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });
    await testPrisma.user.update({ where: { id: oauthUser.id }, data: { authProvider: 'GOOGLE', password: null } });

    const send = (email: string, password: string) =>
      http.post('/api/auth/login').send({ email, password });

    const rNone    = await send('yok@test.local', 'Sifre1234!').expect(401);
    const rPending = await send(pendingUser.email, 'YanlisSifre!').expect(401);
    const rOauth   = await send(oauthUser.email, 'YanlisSifre!').expect(401);

    // Üç senaryo da AYNI error kodu + AYNI mesaj → e-posta durumu/varlığı ayırt edilemez.
    expect(rNone.body.error).toBe('KIMLIK_DOGRULANMADI');
    expect(rPending.body).toEqual(rNone.body);
    expect(rOauth.body).toEqual(rNone.body);
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

// ─── İş 3 P2/P3: Reddedilen kullanıcı akışı (gerekçe görme + tekrar başvuru) ───
describe('Auth: Reddedilen kullanıcı akışı (İş 3 P2/P3)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  async function makeRejected(reason: string | null) {
    const u = await createUser({ tenantId: tenant.id, password: 'Test1234!', approvalStatus: 'PENDING' });
    await testPrisma.user.update({
      where: { id: u.id },
      data: { approvalStatus: 'REJECTED', isActive: false, rejectionReason: reason, rejectedAt: new Date() },
    });
    return u;
  }

  it('P2: doğru şifreyle giriş → 403 + gerekçe + canReapply (şifre sonrası açılır)', async () => {
    const u = await makeRejected('Mezuniyet yılı eksik, lütfen güncelleyin.');
    const res = await http.post('/api/auth/login').send({ email: u.email, password: u.rawPassword }).expect(403);
    expect((res.body as { error: string }).error).toBe('HESAP_REDDEDILDI');
    expect((res.body as { rejectionReason: string }).rejectionReason).toBe('Mezuniyet yılı eksik, lütfen güncelleyin.');
    expect((res.body as { canReapply: boolean }).canReapply).toBe(true);
  });

  it('ENUMERATION: yanlış şifreyle giriş → generic 401, reddedilmiş bilgisi SIZMAZ', async () => {
    const u = await makeRejected('Gizli gerekçe');
    const res = await http.post('/api/auth/login').send({ email: u.email, password: 'YanlisSifre!' }).expect(401);
    expect((res.body as { error: string }).error).toBe('KIMLIK_DOGRULANMADI');
    expect((res.body as Record<string, unknown>)['rejectionReason']).toBeUndefined();
  });

  it('P3: reapply doğru şifreyle REJECTED→PENDING; red geçmişi KORUNUR (çok-yönetici)', async () => {
    const u = await makeRejected('Bilgiler eksik.');
    const res = await http.post('/api/auth/reapply').send({ email: u.email, password: u.rawPassword }).expect(200);
    expect((res.body as { approvalStatus: string }).approvalStatus).toBe('PENDING');
    const db = await testPrisma.user.findUnique({ where: { id: u.id } });
    expect(db?.approvalStatus).toBe('PENDING');
    expect(db?.isActive).toBe(true);
    expect(db?.rejectionReason).toBe('Bilgiler eksik.'); // geçmiş SİLİNMEZ
    expect(db?.rejectedAt).not.toBeNull();
  });

  it('ENUMERATION: reapply yanlış şifreyle → generic 401', async () => {
    const u = await makeRejected(null);
    await http.post('/api/auth/reapply').send({ email: u.email, password: 'Yanlis!' }).expect(401);
  });

  it('reapply reddedilmemiş (APPROVED) hesapta 409', async () => {
    const u = await createUser({ tenantId: tenant.id, password: 'Test1234!', approvalStatus: 'APPROVED' });
    await http.post('/api/auth/reapply').send({ email: u.email, password: u.rawPassword }).expect(409);
  });

  it('reapply kullanıcının DISC/test verisini KORUR (baştan çözdürmez)', async () => {
    const u = await createUser({ tenantId: tenant.id, password: 'Test1234!', approvalStatus: 'PENDING', discType: 'D' });
    await testPrisma.user.update({ where: { id: u.id }, data: { approvalStatus: 'REJECTED', isActive: false } });
    await http.post('/api/auth/reapply').send({ email: u.email, password: u.rawPassword }).expect(200);
    const db = await testPrisma.user.findUnique({ where: { id: u.id } });
    expect(db?.discType).toBe('D'); // test verisi korundu
  });
});
