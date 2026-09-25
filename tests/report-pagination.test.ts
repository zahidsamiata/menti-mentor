/**
 * AN-39 — şikâyet listeleri sayfalı: kurum yöneticisi (`/api/admin/reports`) ve platform
 * (`/api/platform/user-reports`) tek istekte en fazla bir sayfa alır; `total` gerçek sayıdır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import { agent, createTestApp, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createUser } from './helpers/factories.js';

async function seedReports(tenantId: string, count: number) {
  const reporter = await createUser({ tenantId, role: 'MENTI' });
  const target = await createUser({ tenantId, role: 'MENTOR' });
  await testPrisma.userReport.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      tenantId,
      reporterUserId: reporter.id,
      targetUserId: target.id,
      reason: 'OTHER' as const,
      description: `şikayet ${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    })),
  });
}

describe('AN-39: kurum yöneticisi şikâyet listesi sayfalama', () => {
  let http: TestAgent;
  let tenantId: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenant = await createTenant();
    tenantId = tenant.id;
    const admin = await createAdminUser(tenantId);
    token = (await loginAs(http, admin.email, admin.rawPassword)).accessToken;
    await seedReports(tenantId, 7);
  });

  it('limit/offset ile sayfa döner; total tüm kayıt sayısıdır; sayfalar çakışmaz', async () => {
    const p1 = await http.get('/api/admin/reports?limit=3').set(tenantHeaders(tenantId, token)).expect(200);
    const p2 = await http.get('/api/admin/reports?limit=3&offset=3').set(tenantHeaders(tenantId, token)).expect(200);
    const p3 = await http.get('/api/admin/reports?limit=3&offset=6').set(tenantHeaders(tenantId, token)).expect(200);
    expect(p1.body.total).toBe(7);
    expect(p1.body.items).toHaveLength(3);
    expect(p2.body.items).toHaveLength(3);
    expect(p3.body.items).toHaveLength(1);
    const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('negatif: üst sınırın üstü istenirse sınıra kırpılır; geçersiz değerde varsayılan sayfa', async () => {
    const big = await http.get('/api/admin/reports?limit=100000').set(tenantHeaders(tenantId, token)).expect(200);
    expect(big.body.limit).toBe(100);
    const bad = await http.get('/api/admin/reports?limit=abc&offset=-5').set(tenantHeaders(tenantId, token)).expect(200);
    expect(bad.body.limit).toBe(50);
    expect(bad.body.offset).toBe(0);
    expect(bad.body.items).toHaveLength(7);
  });

  it('negatif: başka kurumun şikâyetleri sayıya ve listeye girmez', async () => {
    const other = await createTenant();
    await seedReports(other.id, 4);
    const res = await http.get('/api/admin/reports').set(tenantHeaders(tenantId, token)).expect(200);
    expect(res.body.total).toBe(7);
    expect(res.body.items).toHaveLength(7);
  });
});

describe('AN-39: platform şikâyet listesi sayfalama', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('limit/offset ile sayfa döner; total tüm kurumların toplamıdır', async () => {
    const a = await createTenant();
    const b = await createTenant();
    await seedReports(a.id, 3);
    await seedReports(b.id, 2);
    const plat = supertest.agent(createTestApp());
    await plat
      .post('/api/platform/auth')
      .send({
        email: process.env['PLATFORM_ADMIN_EMAIL'] ?? 'admin@platform.local',
        password: process.env['PLATFORM_ADMIN_KEY'] ?? 'test-platform-key',
      })
      .expect(200);

    const p1 = await plat.get('/api/platform/user-reports?limit=2').expect(200);
    const p3 = await plat.get('/api/platform/user-reports?limit=2&offset=4').expect(200);
    expect(p1.body.total).toBe(5);
    expect(p1.body.items).toHaveLength(2);
    expect(p3.body.items).toHaveLength(1);
  });
});
