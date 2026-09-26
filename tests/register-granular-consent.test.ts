/**
 * AN-30 / KARAR-34 — kayıt ekranında AYRI AYRI rıza kutuları (granüler consent).
 *
 * Kapsam:
 *  - `granularConsent` gönderilmeden kayıt: davranış AYNI kalır (regresyon; asıl kapsamlı
 *    doğrulama `tests/consent-dualwrite.test.ts`'te — burada yalnız yeni alanın davranışı
 *    BOZMADIĞINI teyit ederiz).
 *  - `granularConsent` ile tüm zorunlular true + isteğe bağlılar false/eksik → 6 satır yazılır
 *    (AYDINLATMA, ACIK_RIZA, DISC_ESLESTIRME, YURT_DISI_SAKLAMA, VERI_ISLEME, ANONIM_IYILESTIRME);
 *    KURUMLARARASI_PAYLASIM / OCEAN_PROFIL satırı YOK.
 *  - zorunlu maddelerden biri eksik/false → 400, kullanıcı OLUŞTURULMAZ (transaction rollback).
 *  - isteğe bağlı `true` → ilgili satır da yazılır.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

// AN-30 7b: `granularConsent` artık YALNIZ backend bayrağı (`GRANULAR_CONSENT_ENABLED`) açıkken
// okunur. Bu dosya bayrağı kendi sürecinde açar (desen: tests/oauth-granular-consent.test.ts).
// Bayrak KAPALIYKEN alanın yok sayıldığı: tests/register-granular-consent-flag-off.test.ts.
type RequestModule = typeof import('./helpers/request.js');
let agent: RequestModule['agent'];

beforeAll(async () => {
  vi.stubEnv('GRANULAR_CONSENT_ENABLED', 'true');
  vi.resetModules();
  ({ agent } = await import('./helpers/request.js'));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Kayıt — granüler rıza (AN-30, bayrak AÇIK)', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('granularConsent OLMADAN kayıt: davranış aynı (2 satır — AYDINLATMA+ACIK_RIZA)', async () => {
    const email = `reg-legacy-${Date.now()}@test.local`;
    await agent()
      .post('/api/auth/register')
      .send({
        email,
        password: 'Test1234!',
        fullName: 'Legacy User',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
      })
      .expect(201);

    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });
    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    expect(consents).toHaveLength(2);
    expect(new Set(consents.map((c) => c.type))).toEqual(new Set(['AYDINLATMA', 'ACIK_RIZA']));
  });

  it('granularConsent ile tüm zorunlular true, isteğe bağlılar false: 6 satır, opsiyonel satır YOK', async () => {
    const email = `reg-granular-${Date.now()}@test.local`;
    await agent()
      .post('/api/auth/register')
      .send({
        email,
        password: 'Test1234!',
        fullName: 'Granular User',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        granularConsent: {
          discMatching: true,
          foreignStorage: true,
          dataProcessing: true,
          anonymizedImprovement: true,
          crossTenantSharing: false,
          oceanProfiling: false,
        },
      })
      .expect(201);

    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });
    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    expect(consents).toHaveLength(6);
    expect(new Set(consents.map((c) => c.type))).toEqual(
      new Set(['AYDINLATMA', 'ACIK_RIZA', 'DISC_ESLESTIRME', 'YURT_DISI_SAKLAMA', 'VERI_ISLEME', 'ANONIM_IYILESTIRME']),
    );
    expect(consents.some((c) => c.type === 'KURUMLARARASI_PAYLASIM')).toBe(false);
    expect(consents.some((c) => c.type === 'OCEAN_PROFIL')).toBe(false);
  });

  it('zorunlu madde eksik/false: 400 döner, kullanıcı OLUŞTURULMAZ', async () => {
    const email = `reg-missing-${Date.now()}@test.local`;
    const res = await agent()
      .post('/api/auth/register')
      .send({
        email,
        password: 'Test1234!',
        fullName: 'Missing Consent User',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        granularConsent: {
          discMatching: true,
          foreignStorage: false, // eksik — zorunlu
          dataProcessing: true,
          anonymizedImprovement: true,
        },
      });

    expect(res.status).toBe(400);

    const user = await testPrisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it('isteğe bağlı true: KURUMLARARASI_PAYLASIM ve OCEAN_PROFIL satırı YAZILIR', async () => {
    const email = `reg-optional-${Date.now()}@test.local`;
    await agent()
      .post('/api/auth/register')
      .send({
        email,
        password: 'Test1234!',
        fullName: 'Optional Consent User',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        granularConsent: {
          discMatching: true,
          foreignStorage: true,
          dataProcessing: true,
          anonymizedImprovement: true,
          crossTenantSharing: true,
          oceanProfiling: true,
        },
      })
      .expect(201);

    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });
    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    expect(consents).toHaveLength(8);
    expect(consents.some((c) => c.type === 'KURUMLARARASI_PAYLASIM')).toBe(true);
    expect(consents.some((c) => c.type === 'OCEAN_PROFIL')).toBe(true);
  });
});
