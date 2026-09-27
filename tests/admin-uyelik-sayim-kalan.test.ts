/**
 * AJ-40 (AJ-01 kalanı) — yönetici panelindeki iki sayım da kurum-içi üyelik rolünden
 * (TenantMembership.role, CLAUDE.md "Veri Modeli") — User.role/home tenant değil:
 *   1) GET /api/admin/health-metrics → mentorlessMenti ("Mentörsüz Menti")
 *   2) GET /api/admin/users           → rol filtresi + toplam + gösterilen rol
 *
 * Senaryo: kişi home tenant'ı A olan MENTOR (User.role = MENTOR), B kurumunda ise aktif MENTI üyeliği var.
 * A'da mentör, B'de menti olarak görünmeli; ilgisiz C kurumunun üyesi A/B sayımına girmemeli.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant, User } from '@prisma/client';

type SeededUser = User & { rawPassword: string };
type ListedUser = { id: string; role: string };

async function addMembership(userId: string, tenantId: string, role: 'ADMIN' | 'MENTOR' | 'MENTI') {
  await testPrisma.tenantMembership.create({ data: { userId, tenantId, role, isActive: true } });
}

describe('AJ-40: sağlık metrikleri — Mentörsüz Menti kurum-içi üyelik rolünden', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let dual: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    dual = await createMentor(tenantA.id); // home A, User.role = MENTOR
    await addMembership(dual.id, tenantB.id, 'MENTI');
  });

  async function healthFor(admin: SeededUser, tenant: Tenant) {
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http.get('/api/admin/health-metrics').set(tenantHeaders(tenant.id, accessToken)).expect(200);
    return res.body.mentorlessMenti as { count: number; items: Array<{ id: string }> };
  }

  it('B kurumunda MENTI üyeliği olan kişi B panelinde mentörsüz menti sayılır (User.role MENTOR olsa da)', async () => {
    const m = await healthFor(adminB, tenantB);
    expect(m.count).toBe(1);
    expect(m.items.map((i) => i.id)).toEqual([dual.id]);
  });

  it('negatif: aynı kişi A kurumunda MENTOR — A panelinde mentörsüz menti sayılmaz', async () => {
    const m = await healthFor(adminA, tenantA);
    expect(m.count).toBe(0);
    expect(m.items).toEqual([]);
  });

  it('negatif: ilgisiz C kurumunun mentisi B panelinin sayımına girmez', async () => {
    const tenantC = await createTenant();
    await createMenti(tenantC.id);
    const m = await healthFor(adminB, tenantB);
    expect(m.count).toBe(1); // yalnız dual
  });

  it('başka kurumdaki onaylı eşleşme bu kurumda "mentörü var" saydırmaz; bu kurumdaki eşleşme saydırır', async () => {
    const mentorA = await createMentor(tenantA.id);
    await testPrisma.visibilityOptIn.create({
      data: { tenantId: tenantA.id, mentorId: mentorA.id, mentiId: dual.id, status: 'APPROVED' },
    });
    expect((await healthFor(adminB, tenantB)).count).toBe(1);

    const mentorB = await createMentor(tenantB.id);
    await testPrisma.visibilityOptIn.create({
      data: { tenantId: tenantB.id, mentorId: mentorB.id, mentiId: dual.id, status: 'APPROVED' },
    });
    expect((await healthFor(adminB, tenantB)).count).toBe(0);
  });
});

describe('AJ-40: yönetici kullanıcı listesi — rol filtresi/toplam kurum-içi üyelik rolünden', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let dual: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    dual = await createMentor(tenantA.id); // home A, User.role = MENTOR
    await addMembership(dual.id, tenantB.id, 'MENTI');
  });

  async function listFor(admin: SeededUser, tenant: Tenant, query = '') {
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http.get(`/api/admin/users${query}`).set(tenantHeaders(tenant.id, accessToken)).expect(200);
    return res.body as { items: ListedUser[]; total: number };
  }

  it('B kurumu ?role=MENTI → kişi listede, rolü MENTI gösterilir, toplam 1', async () => {
    const body = await listFor(adminB, tenantB, '?role=MENTI');
    expect(body.total).toBe(1);
    expect(body.items).toEqual([expect.objectContaining({ id: dual.id, role: 'MENTI' })]);
  });

  it('negatif: B kurumu ?role=MENTOR → kişi (home User.role MENTOR) listede YOK', async () => {
    const body = await listFor(adminB, tenantB, '?role=MENTOR');
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('A kurumu ?role=MENTOR → kişi MENTOR; ?role=MENTI → yok', async () => {
    const mentors = await listFor(adminA, tenantA, '?role=MENTOR');
    expect(mentors.items).toEqual([expect.objectContaining({ id: dual.id, role: 'MENTOR' })]);
    const mentis = await listFor(adminA, tenantA, '?role=MENTI');
    expect(mentis.total).toBe(0);
  });

  it('filtresiz toplam yalnız bu kurumun üyeleri; ilgisiz C kurumunun üyesi görünmez', async () => {
    const tenantC = await createTenant();
    const outsider = await createMenti(tenantC.id);

    const body = await listFor(adminB, tenantB);
    expect(body.total).toBe(2); // adminB + dual (B'deki üyelik)
    const ids = body.items.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([adminB.id, dual.id]));
    expect(ids).not.toContain(outsider.id);
    expect(ids).not.toContain(adminA.id);
  });
});

describe('AJ-40 (7b): konuk üyede başka kurum yöneticisinin karar alanları dönmez', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let guest: SeededUser;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    // Home A: A yöneticisi reddetmiş, gerekçe yazmış, rematch önceliği vermiş. B'de aktif MENTI üyeliği var.
    guest = await createMenti(tenantA.id);
    await testPrisma.user.update({
      where: { id: guest.id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: 'A kurumuna ait gizli red gerekçesi',
        rejectedBy: adminA.id,
        rejectedAt: new Date(),
        rematchPriority: true,
        rematchCount: 2,
      },
    });
    await addMembership(guest.id, tenantB.id, 'MENTI');
  });

  async function listFor(admin: SeededUser, tenant: Tenant, query = '') {
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);
    const res = await http.get(`/api/admin/users${query}`).set(tenantHeaders(tenant.id, accessToken)).expect(200);
    return res.body as { items: Array<Record<string, unknown>>; total: number };
  }

  it('negatif: B listesinde konuk görünür ama A\'nın red gerekçesi/karar izi/rematch kararı YOK', async () => {
    const body = await listFor(adminB, tenantB, '?role=MENTI');
    const row = body.items.find((u) => u.id === guest.id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      rejectionReason: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectedByName: null,
      approvedBy: null,
      approvedAt: null,
      rematchPriority: false,
      rematchCount: 0,
    });
    expect(JSON.stringify(body)).not.toContain('A kurumuna ait gizli red gerekçesi');
    expect(JSON.stringify(body)).not.toContain(adminA.id);
  });

  it('negatif: B\'nin ?rematchOnly=true filtresi A\'nın rematch kararıyla konuğu listelemez', async () => {
    const body = await listFor(adminB, tenantB, '?rematchOnly=true');
    expect(body.items.map((u) => u.id)).not.toContain(guest.id);
  });

  it('ev-sahibi kurum (A) listesinde davranış aynı: gerekçe ve rematch alanları görünür', async () => {
    const body = await listFor(adminA, tenantA, '?role=MENTI');
    const row = body.items.find((u) => u.id === guest.id);
    expect(row).toMatchObject({
      rejectionReason: 'A kurumuna ait gizli red gerekçesi',
      rejectedBy: adminA.id,
      rematchPriority: true,
      rematchCount: 2,
    });
  });
});
