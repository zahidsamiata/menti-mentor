/**
 * AJ-111 (md.111 / G2-06) — eşleştirme gevşetme oranı ENTEGRASYON testleri.
 *
 * (1) GET /api/mentors/:mentorId/candidates her istekte kurum + gün + fallbackLevel sayacını
 *     doğru kademede artırır; boş sonuç sayılmaz; kişi kimliği tabloya yazılmaz.
 * (2) GET /api/platform/tenants/:id/analytics → matchingFallback: son 30 gün, yalnız o kurum,
 *     oran doğru; 5 istekten azsa "yetersiz veri".
 * (3) Negatif: kurum yöneticisi / menti platform ucunu çağıramaz (403), metrik dönmez.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';
import { istanbulDay } from '../src/services/matchingFallbackStats.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}
function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

/** Sayaç yanıtı beklemeden (yangın-ve-unut) yazılır — beklenen toplama ulaşana dek kısa yokla. */
async function waitForCount(tenantId: string, level: number, expected: number): Promise<number> {
  let count = 0;
  for (let i = 0; i < 40; i++) {
    const row = await testPrisma.matchingFallbackDailyStat.findFirst({ where: { tenantId, level } });
    count = row?.count ?? 0;
    if (count >= expected) return count;
    await new Promise((r) => setTimeout(r, 50));
  }
  return count;
}

describe('AJ-111: eşleştirme isteği başına gevşetme sayacı', () => {
  let http: TestAgent;
  beforeEach(async () => { await cleanDb(); http = agent(); });

  it('level 3 ile sonuçlanan iki istek → o kurumun bugünkü level-3 sayacı 2; başka kademe yazılmaz', async () => {
    // matching.test.ts "Level 3 Fallback" kurgusu: yüksek baraj + anti-match menti → level 3.
    const tenant = await createTenant();
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: 80 } });
    const mentor = await createMentor(tenant.id, { discType: 'D', sectorTags: ['teknoloji', 'finans', 'sağlık'] });
    await createMenti(tenant.id, { discType: 'S', sectorTags: ['teknoloji', 'sanat'] });
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    for (let i = 0; i < 2; i++) {
      const res = await http.get(`/api/mentors/${mentor.id}/candidates`).set(tenantHeaders(tenant.id, accessToken)).expect(200);
      expect(res.body.fallbackLevel).toBe(3);
    }

    expect(await waitForCount(tenant.id, 3, 2)).toBe(2);
    const rows = await testPrisma.matchingFallbackDailyStat.findMany({ where: { tenantId: tenant.id } });
    expect(rows).toEqual([{ tenantId: tenant.id, day: istanbulDay(new Date()), level: 3, count: 2 }]);
  });

  it('tüm filtrelerle sonuçlanan istek → level 0 sayılır', async () => {
    const tenant = await createTenant({ isSharedPoolActive: false });
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji', 'finans'] });
    await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http.get(`/api/mentors/${mentor.id}/candidates`).set(tenantHeaders(tenant.id, accessToken)).expect(200);
    expect(res.body.fallbackLevel).toBe(0);

    expect(await waitForCount(tenant.id, 0, 1)).toBe(1);
    expect(await testPrisma.matchingFallbackDailyStat.count({ where: { tenantId: tenant.id, level: { gt: 0 } } })).toBe(0);
  });

  it('boş sonuç (havuzda menti yok) sayılmaz', async () => {
    const tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);

    const res = await http.get(`/api/mentors/${mentor.id}/candidates`).set(tenantHeaders(tenant.id, accessToken)).expect(200);
    expect(res.body.items).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 300));
    expect(await testPrisma.matchingFallbackDailyStat.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});

describe('AJ-111: platform kurum analizi — gevşetilen eşleştirme %', () => {
  let http: TestAgent;
  beforeEach(async () => { await cleanDb(); http = agent(); });

  function daysAgo(n: number): Date {
    const d = istanbulDay(new Date());
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  }

  it('son 30 gün, yalnız o kurum: 10 istekten 4 gevşetilmiş → %40; 30 günden eski ve başka kurum sayılmaz', async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    await testPrisma.matchingFallbackDailyStat.createMany({
      data: [
        { tenantId: tenant.id, day: daysAgo(0), level: 0, count: 4 },
        { tenantId: tenant.id, day: daysAgo(29), level: 0, count: 2 }, // pencerenin ilk günü — dahil
        { tenantId: tenant.id, day: daysAgo(3), level: 1, count: 1 },
        { tenantId: tenant.id, day: daysAgo(0), level: 3, count: 3 },
        { tenantId: tenant.id, day: daysAgo(30), level: 3, count: 50 }, // pencere dışı
        { tenantId: other.id, day: daysAgo(0), level: 2, count: 99 },  // başka kurum
      ],
    });

    const res = await http.get(`/api/platform/tenants/${tenant.id}/analytics`).set('Cookie', platformCookie()).expect(200);

    expect(res.body.matchingFallback).toEqual({
      windowDays: 30,
      totalRequests: 10,
      relaxedRequests: 4,
      byLevel: { level1: 1, level2: 0, level3: 3 },
      ratePercent: 40,
      insufficientData: false,
      minSample: 5,
    });
  });

  it('5 istekten az → yetersiz veri, oran null', async () => {
    const tenant = await createTenant();
    await testPrisma.matchingFallbackDailyStat.createMany({
      data: [
        { tenantId: tenant.id, day: daysAgo(0), level: 0, count: 1 },
        { tenantId: tenant.id, day: daysAgo(1), level: 3, count: 3 },
      ],
    });

    const res = await http.get(`/api/platform/tenants/${tenant.id}/analytics`).set('Cookie', platformCookie()).expect(200);

    expect(res.body.matchingFallback.insufficientData).toBe(true);
    expect(res.body.matchingFallback.ratePercent).toBeNull();
    expect(res.body.matchingFallback.totalRequests).toBe(4);
  });

  it('negatif: kurum yöneticisi ve menti (kurum JWT) → 403, metrik dönmez', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const menti = await createMenti(tenant.id);
    await testPrisma.matchingFallbackDailyStat.create({ data: { tenantId: tenant.id, day: daysAgo(0), level: 3, count: 9 } });

    for (const u of [admin, menti]) {
      const res = await http
        .get(`/api/platform/tenants/${tenant.id}/analytics`)
        .set('Cookie', `platform_token=${encodeURIComponent(tokenFor(u))}`);
      expect(res.status).toBe(403);
      expect(res.body.matchingFallback).toBeUndefined();
    }
  });
});
