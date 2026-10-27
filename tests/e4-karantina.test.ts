/**
 * E-4 · KARANTİNA — silme protokolü adım 5 (KARAR-11 = A). Mükerrer ve ön yüzün çağırmadığı yedi uç
 * `quarantined()` kapısıyla 410'a çekildi; kod yerinde duruyor, hiçbir şey silinmedi.
 *
 * Bu dosya dört şeyi kanıtlar:
 *  (1) Karantinadaki her uç, YETKİLİ çağırana bile 410 + `ENDPOINT_QUARANTINED` döner ve handler
 *      ÇALIŞMAZ (yazan uçlarda DB değişmez — düzeltme geri alınırsa bu testler KIRMIZI olur).
 *  (2) Kimlik doğrulama kapıdan ÖNCE çalışır: oturumsuz istek eskisi gibi 401 alır.
 *  (3) İkame uçlar ve aynı rota dosyasındaki karantinaya ALINMAYAN komşu uçlar çalışmaya devam eder.
 *  (4) `QUARANTINE_REOPEN` ortam değişkeni ucu geri açar (acil geri alma yolu) ve çağrı SystemLog'a
 *      id içermeyen rota kalıbıyla yazılır.
 *
 * Arşiv: çatı reposu `docs/arsiv/silinenler-2026-09-10.md`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMenti } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import systemLogRoutes from '../src/routes/systemLogRoutes.js';
import { notFoundHandler, globalErrorHandler } from '../src/middleware/errorHandler.js';
import {
  isQuarantineReopened,
  QUARANTINE_ERROR_CODE,
  QUARANTINE_REOPEN_ENV,
} from '../src/middleware/quarantine.js';
import type { Tenant, User } from '@prisma/client';

function platformCookie(): Record<string, string> {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return { Cookie: `platform_token=${encodeURIComponent(token)}` };
}

function authAs(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): Record<string, string> {
  return tenantHeaders(u.tenantId, signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName }));
}

// Üretimde /api/system-logs server.ts'te bağlı; ortak test uygulamasında yok → security.test.ts deseni.
function systemLogApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/system-logs', systemLogRoutes);
  app.use(notFoundHandler);
  app.use(globalErrorHandler);
  return supertest(app);
}

function expectQuarantined(res: { status: number; body: unknown }) {
  expect(res.status).toBe(410);
  expect((res.body as { error?: string }).error).toBe(QUARANTINE_ERROR_CODE);
}

async function waitForQuarantineLog(key: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const log = await testPrisma.systemLog.findFirst({
      where: { category: 'HTTP', message: `Karantinadaki uç çağrıldı: ${key}` },
      orderBy: { createdAt: 'desc' },
    });
    if (log) return log;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

// ─── Saf karar fonksiyonu ─────────────────────────────────────────────────────
describe('E-4: isQuarantineReopened', () => {
  it('değişken yoksa ya da boşsa kapı kapalı kalır', () => {
    expect(isQuarantineReopened('system-logs', undefined)).toBe(false);
    expect(isQuarantineReopened('system-logs', '')).toBe(false);
  });
  it('yalnız adı tam geçen anahtar açılır (boşluklar yok sayılır, önek eşleşmez)', () => {
    expect(isQuarantineReopened('system-logs', 'tenants-list, system-logs')).toBe(true);
    expect(isQuarantineReopened('tenants-get', 'tenants-list')).toBe(false);
    expect(isQuarantineReopened('tenants-list', 'tenants')).toBe(false);
  });
});

// ─── HTTP davranışı ───────────────────────────────────────────────────────────
describe('E-4: karantinadaki uçlar 410 döner, komşular etkilenmez', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let admin: User;
  let menti: User;

  beforeEach(async () => {
    delete process.env[QUARANTINE_REOPEN_ENV];
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    admin = await createAdminUser(tenant.id);
    menti = await createMenti(tenant.id);
  });

  afterEach(() => {
    delete process.env[QUARANTINE_REOPEN_ENV];
  });

  // (1) super-admin: durum değiştirme — handler çalışsaydı kurum askıya alınırdı.
  it('PATCH /api/super-admin/tenants/:id/status → 410, kurum durumu DEĞİŞMEZ', async () => {
    const res = await http.patch(`/api/super-admin/tenants/${tenant.id}/status`)
      .set(platformCookie()).send({ isActive: false });
    expectQuarantined(res);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.isActive).toBe(true);
  });

  it('GET /api/super-admin/tenants/pending → 410', async () => {
    expectQuarantined(await http.get('/api/super-admin/tenants/pending').set(platformCookie()));
  });

  it('GET /api/system-logs → 410', async () => {
    expectQuarantined(await systemLogApp().get('/api/system-logs').set(platformCookie()));
  });

  it('GET /api/tenants → 410 · GET /api/tenants/:id → 410', async () => {
    expectQuarantined(await http.get('/api/tenants').set(platformCookie()));
    expectQuarantined(await http.get(`/api/tenants/${tenant.id}`).set(platformCookie()));
  });

  // (1) me/social — handler çalışsaydı bağlantı yazılırdı.
  it('PATCH /api/users/me/social → 410, profil DEĞİŞMEZ', async () => {
    const res = await http.patch('/api/users/me/social').set(authAs(menti))
      .send({ linkedinUrl: 'https://www.linkedin.com/in/karantina' });
    expectQuarantined(res);
    const after = await testPrisma.user.findUnique({ where: { id: menti.id } });
    expect(after!.linkedinUrl).toBeNull();
  });

  it('GET /api/meetings/pair-signal → 410', async () => {
    const res = await http.get('/api/meetings/pair-signal')
      .query({ mentorId: admin.id, mentiId: menti.id }).set(authAs(admin));
    expectQuarantined(res);
  });

  // (2) Kimlik doğrulama kapıdan önce: oturumsuz/yanlış rol eskisi gibi.
  it('negatif: oturumsuz istek 410 değil 401 alır; yanlış rol 403 alır', async () => {
    expect((await http.get('/api/tenants')).status).toBe(401);
    expect((await http.get('/api/super-admin/tenants/pending')).status).toBe(401);
    expect((await systemLogApp().get('/api/system-logs')).status).toBe(401);
    expect((await http.patch('/api/users/me/social').set({ 'X-Tenant-Id': tenant.id }).send({})).status).toBe(401);
    const res = await http.get('/api/meetings/pair-signal')
      .query({ mentorId: admin.id, mentiId: menti.id }).set(authAs(menti));
    expect(res.status).toBe(403);
  });

  // (3) İkame uçlar çalışıyor.
  it('ikame: /api/platform/logs · /tenants · /tenants/pending · /tenants/:id/overview → 200', async () => {
    await http.get('/api/platform/logs').set(platformCookie()).expect(200);
    await http.get('/api/platform/tenants').set(platformCookie()).expect(200);
    await http.get('/api/platform/tenants/pending').set(platformCookie()).expect(200);
    await http.get(`/api/platform/tenants/${tenant.id}/overview`).set(platformCookie()).expect(200);
  });

  it('ikame: POST /api/platform/tenants/:id/freeze kurumu gerçekten askıya alır', async () => {
    await http.post(`/api/platform/tenants/${tenant.id}/freeze`).set(platformCookie()).expect(200);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.isActive).toBe(false);
  });

  it('ikame: PATCH /api/users/me/profile sosyal bağlantıyı yazar', async () => {
    await http.patch('/api/users/me/profile').set(authAs(menti))
      .send({ linkedinUrl: 'https://www.linkedin.com/in/ikame' }).expect(200);
    const after = await testPrisma.user.findUnique({ where: { id: menti.id } });
    expect(after!.linkedinUrl).toBe('https://www.linkedin.com/in/ikame');
  });

  // (3) Aynı rota dosyasında karantinaya ALINMAYAN komşular açık.
  it('komşu: GET /api/super-admin/dashboard 200 · POST /api/tenants 201 (karantinada değil)', async () => {
    await http.get('/api/super-admin/dashboard').set(platformCookie()).expect(200);
    await http.post('/api/tenants').set(platformCookie())
      .send({ name: 'Komşu Kurum', slug: `komsu-${Date.now()}` }).expect(201);
  });

  // (4) Acil geri açma + kayıt.
  it('QUARANTINE_REOPEN yalnız adı geçen ucu açar', async () => {
    process.env[QUARANTINE_REOPEN_ENV] = 'tenants-list';
    await http.get('/api/tenants').set(platformCookie()).expect(200);
    expectQuarantined(await http.get(`/api/tenants/${tenant.id}`).set(platformCookie()));
  });

  it('çağrı SystemLog\'a rota KALIBIYLA yazılır (id kayda girmez)', async () => {
    await http.get(`/api/tenants/${tenant.id}`).set(platformCookie());
    const log = await waitForQuarantineLog('tenants-get');
    expect(log).not.toBeNull();
    expect(log!.level).toBe('WARN');
    const meta = log!.meta as { route?: string; method?: string };
    expect(meta.route).toBe('/api/tenants/:id');
    expect(meta.method).toBe('GET');
    expect(JSON.stringify(log)).not.toContain(tenant.id);
  });
});
