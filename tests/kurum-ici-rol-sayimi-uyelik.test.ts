/**
 * AJ-01 — kurum-içi rol/sayım TenantMembership.role üzerinden (CLAUDE.md "Veri Modeli") —
 * User.role değil. Bir kullanıcı A kurumunda bir rolde, B kurumunda BAŞKA bir rolde
 * (aktif üyelik) olabilir; admin panel/KPI sayımları HER kurumun kendi üyelik rolünü
 * yansıtmalı — kullanıcının "home" User.role'ü ne olursa olsun.
 *
 * Kapsam: GET /api/admin/kpi (usersByRole), GET /api/admin/health-metrics (arz-talep),
 * GET /api/admin/managers + promote-admin limiti (ADMIN sayımı).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant, User } from '@prisma/client';

type SeededUser = User & { rawPassword: string };

/** Verilen kullanıcıya, EK bir kurumda belirtilen rolle aktif üyelik ekler (çok-kurumlu senaryo). */
async function addMembership(userId: string, tenantId: string, role: 'ADMIN' | 'MENTOR' | 'MENTI') {
  await testPrisma.tenantMembership.create({
    data: { userId, tenantId, role, isActive: true },
  });
}

describe('AJ-01: KPI paneli — usersByRole kurum-içi üyelik rolünden', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let dualCitizen: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant({ name: 'Kurum A' });
    tenantB = await createTenant({ name: 'Kurum B' });
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);

    // Home tenant'ı A, User.role = MENTOR. Ayrıca B'de MENTI olarak aktif üye.
    dualCitizen = await createMentor(tenantA.id);
    await addMembership(dualCitizen.id, tenantB.id, 'MENTI');
  });

  it('A kurumu KPI paneli çok-kurumlu kullanıcıyı MENTOR sayar', async () => {
    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantA.id, accessToken)).expect(200);

    expect(res.body.stats.usersByRole.MENTOR).toBe(1); // dualCitizen
    expect(res.body.stats.usersByRole.MENTI ?? 0).toBe(0);
    expect(res.body.stats.totalActiveUsers).toBe(2); // adminA + dualCitizen (A'daki üyelik)
  });

  it('B kurumu KPI paneli AYNI kullanıcıyı MENTI sayar — User.role (MENTOR) yok sayılır', async () => {
    const { accessToken } = await loginAs(http, adminB.email, adminB.rawPassword);
    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantB.id, accessToken)).expect(200);

    expect(res.body.stats.usersByRole.MENTI).toBe(1); // dualCitizen, B'deki üyelik rolüyle
    expect(res.body.stats.usersByRole.MENTOR ?? 0).toBe(0);
    expect(res.body.stats.totalActiveUsers).toBe(2); // adminB + dualCitizen (B'deki üyelik)
  });

  it('negatif: C kurumunun üyesi A kurumunun sayımına girmez', async () => {
    const tenantC = await createTenant({ name: 'Kurum C' });
    await createMenti(tenantC.id);

    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantA.id, accessToken)).expect(200);

    expect(res.body.stats.totalActiveUsers).toBe(2); // C'nin üyesi sayılmadı
  });
});

describe('AJ-01: sağlık metrikleri (arz-talep) — üyelik rolünden', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
  });

  it('B kurumunda MENTOR olan, A kurumunda yalnız MENTI üyeliği varsa A arz-talebinde MENTI sayılır', async () => {
    // Home tenant B, User.role = MENTOR (B'nin kendi kurucu mentörü).
    const dual = await createMentor(tenantB.id);
    await addMembership(dual.id, tenantA.id, 'MENTI');

    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http
      .get('/api/admin/health-metrics')
      .set(tenantHeaders(tenantA.id, accessToken))
      .expect(200);

    expect(res.body.supplyDemand.mentis).toBe(1);
    expect(res.body.supplyDemand.mentors).toBe(0);
  });
});

describe('AJ-01: yönetici (ADMIN) sayımı — kurumlar-arası konuk üyelik doğru sayılır', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
  });

  it('home tenant\'ı B olan ama A\'da aktif ADMIN üyeliği olan kişi /managers listesinde görünür', async () => {
    // Home tenant B, User.role = MENTOR — ama A kurumunda ayrıca ADMIN üyeliği var (konuk yönetici).
    const guest = await createMentor(tenantB.id);
    await addMembership(guest.id, tenantA.id, 'ADMIN');

    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const res = await http.get('/api/admin/managers').set(tenantHeaders(tenantA.id, accessToken)).expect(200);

    expect(res.body.total).toBe(2); // adminA + guest
    expect(res.body.items.map((u: { id: string }) => u.id)).toEqual(
      expect.arrayContaining([adminA.id, guest.id]),
    );
  });

  it('konuk ADMIN üyeliği de limite (max 3) dahil edilir — eskiden User.tenantId farklı olduğu için sayılmıyordu', async () => {
    // A'da 2. ev sahibi admin + B'den bir konuk ADMIN üyeliği = limit (3) doldu.
    await createAdminUser(tenantA.id);
    const guest = await createMentor(tenantB.id);
    await addMembership(guest.id, tenantA.id, 'ADMIN');

    const { accessToken } = await loginAs(http, adminA.email, adminA.rawPassword);
    const mentor = await createMentor(tenantA.id);
    const res = await http
      .post(`/api/admin/users/${mentor.id}/promote-admin`)
      .set(tenantHeaders(tenantA.id, accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ADMIN_LIMITI_ASILDI');
  });
});
