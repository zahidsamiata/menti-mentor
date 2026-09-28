/**
 * AN-30 7b — `GRANULAR_CONSENT_ENABLED` KAPALIYKEN (varsayılan) granüler yol HİÇ kullanılmaz.
 *
 *  - Form kaydı `granularConsent` gönderse bile alan yok sayılır → eski davranış birebir
 *    (yalnız AYDINLATMA + ACIK_RIZA). Geçersiz (false) değer bile 400 üretmez — eski şema
 *    bilinmeyen alanı zaten atıyordu. Böylece migration uygulanmadan alan gönderen bir
 *    istemci yeni enum değerlerine yazmaya çalışıp 500 alamaz.
 *  - `POST /api/auth/oauth/complete-registration` 404 döner (bayrak kapatıldıktan sonra
 *    önceden üretilmiş bekleyen kayıt token'ları kullanılamaz).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

type RequestModule = typeof import('./helpers/request.js');
let agent: RequestModule['agent'];

beforeAll(async () => {
  vi.stubEnv('GRANULAR_CONSENT_ENABLED', 'false');
  vi.resetModules();
  ({ agent } = await import('./helpers/request.js'));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('AN-30 — bayrak KAPALI: granüler yol devre dışı', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
  });

  it('form kaydı granularConsent gönderse de yok sayılır: 201 + yalnız AYDINLATMA+ACIK_RIZA', async () => {
    const email = `reg-flagoff-${Date.now()}@test.local`;
    await agent()
      .post('/api/auth/register')
      .send({
        email,
        password: 'Test1234!',
        fullName: 'Flag Off User',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        granularConsent: {
          discMatching: true,
          foreignStorage: false, // bayrak açıkken 400 olurdu — kapalıyken alan hiç okunmaz
          dataProcessing: true,
          anonymizedImprovement: true,
          crossTenantSharing: true,
          oceanProfiling: true,
        },
      })
      .expect(201);

    const user = await testPrisma.user.findUnique({ where: { email }, select: { id: true } });
    const consents = await testPrisma.consent.findMany({ where: { userId: user!.id } });
    expect(new Set(consents.map((c) => c.type))).toEqual(new Set(['AYDINLATMA', 'ACIK_RIZA']));
    expect(consents).toHaveLength(2);
  });

  it('complete-registration ucu 404 döner', async () => {
    const res = await agent()
      .post('/api/auth/oauth/complete-registration')
      .send({
        pendingToken: 'herhangi.bir.token',
        kvkkConsent: true,
        granularConsent: { discMatching: true, foreignStorage: true, dataProcessing: true, anonymizedImprovement: true },
      });
    expect(res.status).toBe(404);
  });
});
