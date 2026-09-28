/**
 * AJ-89 — GET /api/admin/kpi `stats.mentiNeeds`: mentilerin S1 ("şu an en çok neye ihtiyacın var?")
 * cevaplarının kurum yöneticisine TOPLU dağılımı (§10.3, PO kararı: yönetici kişiye inmez).
 *
 * Ölçülenler (uçtan uca, gerçek DB):
 * 1. Kurum izolasyonu: A yöneticisi yalnız A'nın mentilerini görür — B'nin cevapları sayıma girmez (negatif).
 * 2. Kurum sınırı üyelikten: başka kurumun kullanıcısı A'da MENTI üyeyse A'da sayılır; A'da mentör
 *    üyeliği olan kişinin (User.role ne olursa olsun) S1'i sayılmaz.
 * 3. k-anonimlik: eşik altı seçenek gizli; cevaplayan sayısı eşik altındaysa dağılımın tamamı gizli.
 * 4. Yetki: MENTOR / MENTI → 403 (uç yalnız kurum yöneticisine).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { MentiNeed, User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

async function mentiWithNeeds(tenantId: string, mentiNeeds: MentiNeed[]) {
  const u = await createMenti(tenantId);
  await testPrisma.user.update({ where: { id: u.id }, data: { mentiNeeds } });
  return u;
}

type Cell = { need: MentiNeed; count: number; percent: number | null; suppressed: boolean };
const cellOf = (body: { stats: { mentiNeeds: { options: Cell[] } } }, need: MentiNeed) =>
  body.stats.mentiNeeds.options.find((o) => o.need === need);

describe('AJ-89: yönetici KPI — menti S1 ihtiyaç dağılımı', () => {
  let http: TestAgent;
  beforeEach(async () => { await cleanDb(); http = agent(); });

  it('negatif: A yöneticisi yalnız A kurumunun dağılımını görür — B\'nin cevapları sayılmaz', async () => {
    const tenantA = await createTenant({ name: 'Kurum A' });
    const tenantB = await createTenant({ name: 'Kurum B' });
    const adminA = await createAdminUser(tenantA.id);

    for (let i = 0; i < 3; i++) await mentiWithNeeds(tenantA.id, ['KARAR_VEREMIYORUM']);
    // B kurumunda 5 menti — A'nın hiç seçmediği bir seçeneği işaretliyor.
    for (let i = 0; i < 5; i++) await mentiWithNeeds(tenantB.id, ['INSANLARI_TANIMIYORUM', 'GUVENMIYORUM']);

    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantA.id, tokenFor(adminA))).expect(200);

    expect(res.body.stats.mentiNeeds.suppressed).toBe(false);
    expect(res.body.stats.mentiNeeds.respondentCount).toBe(3);
    expect(cellOf(res.body, 'KARAR_VEREMIYORUM')).toEqual({ need: 'KARAR_VEREMIYORUM', count: 3, percent: 100, suppressed: false });
    expect(cellOf(res.body, 'INSANLARI_TANIMIYORUM')).toEqual({ need: 'INSANLARI_TANIMIYORUM', count: 0, percent: null, suppressed: true });
    expect(cellOf(res.body, 'GUVENMIYORUM')).toMatchObject({ count: 0, suppressed: true });
  });

  it('kurum sınırı üyelikten: A\'da MENTI üyesi misafir sayılır, A\'da MENTOR üyesinin S1\'i sayılmaz', async () => {
    const tenantA = await createTenant({ name: 'Kurum A' });
    const tenantB = await createTenant({ name: 'Kurum B' });
    const adminA = await createAdminUser(tenantA.id);

    for (let i = 0; i < 2; i++) await mentiWithNeeds(tenantA.id, ['BECERIDE_TAKILDIM']);
    // Ev kurumu B (User.role MENTOR) ama A'da aktif MENTI üyeliği var → A'da sayılır.
    const guest = await createMentor(tenantB.id);
    await testPrisma.user.update({ where: { id: guest.id }, data: { mentiNeeds: ['BECERIDE_TAKILDIM'] } });
    await testPrisma.tenantMembership.create({ data: { userId: guest.id, tenantId: tenantA.id, role: 'MENTI', isActive: true } });
    // A'da MENTOR üyesi — alanı dolu olsa bile menti ihtiyacı olarak sayılmaz.
    const mentorA = await createMentor(tenantA.id);
    await testPrisma.user.update({ where: { id: mentorA.id }, data: { mentiNeeds: ['KONUSACAK_BIRI'] } });

    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenantA.id, tokenFor(adminA))).expect(200);

    expect(res.body.stats.mentiNeeds.respondentCount).toBe(3);
    expect(cellOf(res.body, 'BECERIDE_TAKILDIM')).toMatchObject({ count: 3, percent: 100, suppressed: false });
    expect(cellOf(res.body, 'KONUSACAK_BIRI')).toMatchObject({ count: 0, suppressed: true });
  });

  it('negatif: 3\'ten az menti cevap verdiyse dağılımın tamamı gizli — hiçbir seçenek dönmez', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    await mentiWithNeeds(tenant.id, ['GUVENMIYORUM']);
    await mentiWithNeeds(tenant.id, ['GUVENMIYORUM', 'KONUSACAK_BIRI']);
    await createMenti(tenant.id); // S1 boş (EK2) — paydaya girmez

    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id, tokenFor(admin))).expect(200);

    expect(res.body.stats.mentiNeeds).toEqual({ respondentCount: 0, suppressed: true, minGroupSize: 3, options: [] });
  });

  it('negatif: eşik altındaki seçenek hücresi gizli, eşik ve üstü sayı + yüzde', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    for (let i = 0; i < 3; i++) await mentiWithNeeds(tenant.id, ['KARAR_VEREMIYORUM']);
    await mentiWithNeeds(tenant.id, ['GUVENMIYORUM']); // tek kişi — gizli kalmalı

    const res = await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id, tokenFor(admin))).expect(200);

    expect(res.body.stats.mentiNeeds.respondentCount).toBe(4);
    expect(cellOf(res.body, 'KARAR_VEREMIYORUM')).toEqual({ need: 'KARAR_VEREMIYORUM', count: 3, percent: 75, suppressed: false });
    expect(cellOf(res.body, 'GUVENMIYORUM')).toEqual({ need: 'GUVENMIYORUM', count: 0, percent: null, suppressed: true });
  });

  it('negatif: MENTOR ve MENTI dağılımı göremez (403)', async () => {
    const tenant = await createTenant();
    const mentor = await createMentor(tenant.id);
    const menti = await createMenti(tenant.id);

    const r1 = await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id, tokenFor(mentor))).expect(403);
    const r2 = await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id, tokenFor(menti))).expect(403);
    expect(r1.body.stats).toBeUndefined();
    expect(r2.body.stats).toBeUndefined();
  });
});
