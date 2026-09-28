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

/**
 * AJ-56 (AJ-40 kalanı) — misafir üye (ev-sahibi kurumu A, B'de aktif üyeliği var) B yöneticisinin
 * BU KURUMA ÖZGÜ okuma/hatırlatma işlemlerinde görünür: pasif üye sayımı, onaylayan adı, hatırlatma,
 * koçluk önerisi. Kişi-genel alan yazan işlemler (onay/ret/düzeltme/yeniden eşleştirme/yönetici
 * yap-geri al) KARAR-133 cevabına kadar misafirde 404 kalır ve kayıt DEĞİŞMEZ (negatif kilit).
 */
describe('AJ-56: misafir üye — bu kuruma özgü okuma/hatırlatma üyelikten', () => {
  const PASSIVE_LOGIN_DAYS_AGO = 60; // varsayılan pasif eşiği (30 gün) aşılır

  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let tenantC: Tenant;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let guest: SeededUser;
  let outsider: SeededUser;

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    tenantC = await createTenant();
    adminA = await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    // Ev-sahibi A (User.role MENTOR), B'de aktif MENTI üyeliği; uzun süredir giriş yok.
    guest = await createMentor(tenantA.id);
    await addMembership(guest.id, tenantB.id, 'MENTI');
    // İlgisiz C kurumunun üyesi — B'de üyeliği YOK.
    outsider = await createMenti(tenantC.id);
    await testPrisma.user.updateMany({
      where: { id: { in: [guest.id, outsider.id] } },
      data: { lastLoginAt: daysAgo(PASSIVE_LOGIN_DAYS_AGO) },
    });
  });

  async function tokenFor(admin: SeededUser) {
    return (await loginAs(http, admin.email, admin.rawPassword)).accessToken;
  }

  it('B panelinde misafir üye pasif üye sayılır, rolü B üyelik rolü (MENTI); C üyesi sayılmaz', async () => {
    const token = await tokenFor(adminB);
    const res = await http.get('/api/admin/health-metrics').set(tenantHeaders(tenantB.id, token)).expect(200);
    const passive = res.body.passiveMembers as { count: number; items: Array<{ id: string; role: string }> };
    expect(passive.count).toBe(1);
    expect(passive.items).toEqual([expect.objectContaining({ id: guest.id, role: 'MENTI' })]);
    expect(passive.items.map((i) => i.id)).not.toContain(outsider.id);
  });

  it('negatif: B\'deki üyeliği pasif olan misafir B pasif sayımına girmez', async () => {
    await testPrisma.tenantMembership.updateMany({
      where: { userId: guest.id, tenantId: tenantB.id },
      data: { isActive: false },
    });
    const token = await tokenFor(adminB);
    const res = await http.get('/api/admin/health-metrics').set(tenantHeaders(tenantB.id, token)).expect(200);
    expect(res.body.passiveMembers.count).toBe(0);
  });

  it('onaylayan misafir yöneticinin adı çözülür; B\'de üyeliği olmayan yöneticinin adı sızmaz', async () => {
    // Misafir yönetici: ev-sahibi A, B'de ADMIN üyeliği var; B'nin iki üyesini onaylamış kabul edilir.
    const guestAdmin = await createMentor(tenantA.id);
    await addMembership(guestAdmin.id, tenantB.id, 'ADMIN');
    const approvedByGuestAdmin = await createMenti(tenantB.id);
    const approvedByAdminA = await createMenti(tenantB.id);
    await testPrisma.user.update({
      where: { id: approvedByGuestAdmin.id },
      data: { approvedBy: guestAdmin.id, approvedAt: new Date() },
    });
    await testPrisma.user.update({
      where: { id: approvedByAdminA.id },
      data: { approvedBy: adminA.id, approvedAt: new Date() },
    });

    const token = await tokenFor(adminB);
    const res = await http.get('/api/admin/users?role=MENTI').set(tenantHeaders(tenantB.id, token)).expect(200);
    const items = res.body.items as Array<{ id: string; approvedByName: string | null }>;
    expect(items.find((u) => u.id === approvedByGuestAdmin.id)?.approvedByName).toBe(guestAdmin.fullName);
    expect(items.find((u) => u.id === approvedByAdminA.id)?.approvedByName).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(adminA.fullName);
  });

  it('B yöneticisi misafir üyeye hatırlatma gönderir (200) ve denetim kaydı B kurumuyla yazılır', async () => {
    const token = await tokenFor(adminB);
    const res = await http
      .post(`/api/admin/users/${guest.id}/nudge`)
      .set(tenantHeaders(tenantB.id, token))
      .send({ kind: 'PASSIVE' })
      .expect(200);
    expect(res.body).toMatchObject({ ok: true, targetUserId: guest.id });
    const logs = await testPrisma.systemLog.findMany({
      where: { category: 'AUDIT', message: 'NUDGE_SENT', meta: { path: ['targetUserId'], equals: guest.id } },
      select: { meta: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.meta).toMatchObject({ tenantId: tenantB.id, byUserId: adminB.id });
  });

  it('hatırlatma limiti kurum başına: A\'nın dürtmesi B yöneticisine 429 olarak sızmaz', async () => {
    const tokenA = await tokenFor(adminA);
    await http.post(`/api/admin/users/${guest.id}/nudge`).set(tenantHeaders(tenantA.id, tokenA)).send({}).expect(200);
    const tokenB = await tokenFor(adminB);
    await http.post(`/api/admin/users/${guest.id}/nudge`).set(tenantHeaders(tenantB.id, tokenB)).send({}).expect(200);
    // Aynı kurumda ikinci dürtme hâlâ limitli.
    await http.post(`/api/admin/users/${guest.id}/nudge`).set(tenantHeaders(tenantB.id, tokenB)).send({}).expect(429);
  });

  it('B yöneticisi misafir üyenin koçluk önerilerini okur (200); A\'nın yeniden eşleşme sayısı sinyal olarak sızmaz', async () => {
    await testPrisma.user.update({ where: { id: guest.id }, data: { rematchCount: 5 } });
    const token = await tokenFor(adminB);
    const res = await http
      .get(`/api/admin/users/${guest.id}/coaching-suggestions`)
      .set(tenantHeaders(tenantB.id, token))
      .expect(200);
    expect(res.body.userId).toBe(guest.id);
    const codes = (res.body.items as Array<{ code: string }>).map((s) => s.code);
    // A'nın kararı olan yeniden eşleşme sayısı (AJ-40 maskesi) B'ye öneri olarak yansımaz.
    expect(codes).not.toContain('HIGH_REMATCH_COUNT');
    // Ev-sahibi A yöneticisi aynı öneriyi görür (davranış korunur).
    const tokenA = await tokenFor(adminA);
    const resA = await http
      .get(`/api/admin/users/${guest.id}/coaching-suggestions`)
      .set(tenantHeaders(tenantA.id, tokenA))
      .expect(200);
    expect((resA.body.items as Array<{ code: string }>).map((s) => s.code)).toContain('HIGH_REMATCH_COUNT');
  });

  it('negatif: B\'de üyeliği olmayan (C) kişiye hatırlatma ve koçluk önerisi → 404, kayıt yazılmaz', async () => {
    const token = await tokenFor(adminB);
    await http.post(`/api/admin/users/${outsider.id}/nudge`).set(tenantHeaders(tenantB.id, token)).send({}).expect(404);
    const res = await http
      .get(`/api/admin/users/${outsider.id}/coaching-suggestions`)
      .set(tenantHeaders(tenantB.id, token))
      .expect(404);
    expect(res.body).not.toHaveProperty('items');
    const logs = await testPrisma.systemLog.count({
      where: { category: 'AUDIT', message: 'NUDGE_SENT', meta: { path: ['targetUserId'], equals: outsider.id } },
    });
    expect(logs).toBe(0);
  });

  it('negatif: B\'deki üyeliği pasif misafire hatırlatma → 404', async () => {
    await testPrisma.tenantMembership.updateMany({
      where: { userId: guest.id, tenantId: tenantB.id },
      data: { isActive: false },
    });
    const token = await tokenFor(adminB);
    await http.post(`/api/admin/users/${guest.id}/nudge`).set(tenantHeaders(tenantB.id, token)).send({}).expect(404);
  });
});

describe('AJ-56 negatif kilit (KARAR-133): başka kurumun yöneticisi misafirin kişi-genel alanlarını DEĞİŞTİREMEZ', () => {
  let http: TestAgent;
  let tenantA: Tenant;
  let tenantB: Tenant;
  let adminB: SeededUser;
  let guest: SeededUser;
  let guestAdmin: SeededUser;
  let tokenB: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenantA = await createTenant();
    tenantB = await createTenant();
    await createAdminUser(tenantA.id);
    adminB = await createAdminUser(tenantB.id);
    // Onay bekleyen misafir: ev-sahibi A, B'de MENTI üyeliği.
    guest = await createMenti(tenantA.id, { approvalStatus: 'PENDING' });
    await addMembership(guest.id, tenantB.id, 'MENTI');
    // Misafir yönetici: ev-sahibi A'da ADMIN, B'de de ADMIN üyeliği.
    guestAdmin = await createAdminUser(tenantA.id);
    await addMembership(guestAdmin.id, tenantB.id, 'ADMIN');
    tokenB = (await loginAs(http, adminB.email, adminB.rawPassword)).accessToken;
  });

  async function personState(userId: string) {
    return testPrisma.user.findUnique({
      where: { id: userId },
      select: {
        approvalStatus: true, approvedBy: true, rejectedBy: true, rejectionReason: true,
        role: true, rematchPriority: true, rematchCount: true,
      },
    });
  }

  async function memberRoleIn(userId: string, tenantId: string) {
    return (await testPrisma.tenantMembership.findFirst({ where: { userId, tenantId }, select: { role: true } }))?.role;
  }

  it('onayla / reddet / düzeltme iste / yeniden eşleştir → 404 ve kişi kaydı değişmez', async () => {
    const before = await personState(guest.id);
    const post = (path: string, body: object) =>
      http.post(`/api/admin/users/${guest.id}/${path}`).set(tenantHeaders(tenantB.id, tokenB)).send(body);

    await post('approve', {}).expect(404);
    await post('reject', { reason: 'B kurumunun reddi' }).expect(404);
    await post('request-correction', { feedbackNote: 'B kurumundan düzeltme isteği notu' }).expect(404);
    await post('rematch', { reason: 'B kurumunun yeniden eşleştirmesi' }).expect(404);

    expect(await personState(guest.id)).toEqual(before);
    expect(before?.approvalStatus).toBe('PENDING');
  });

  it('yönetici yap / yönetici geri al → 404; kişi rolü ve B üyelik rolü değişmez', async () => {
    const guestBefore = await personState(guest.id);
    const adminBefore = await personState(guestAdmin.id);

    await http.post(`/api/admin/users/${guest.id}/promote-admin`).set(tenantHeaders(tenantB.id, tokenB)).expect(404);
    await http.post(`/api/admin/users/${guestAdmin.id}/demote-admin`).set(tenantHeaders(tenantB.id, tokenB)).expect(404);

    expect(await personState(guest.id)).toEqual(guestBefore);
    expect(await personState(guestAdmin.id)).toEqual(adminBefore);
    expect(await memberRoleIn(guest.id, tenantB.id)).toBe('MENTI');
    expect(await memberRoleIn(guestAdmin.id, tenantB.id)).toBe('ADMIN');
  });
});
