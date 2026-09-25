/**
 * PS-07 · Eşleştirmenin ANLAMI — uç düzeyinde sıralama (entegrasyon).
 *
 * `GET /api/mentors/:mentorId/candidates` (mentor → menti) ve
 * `GET /api/mentis/:mentiId/mentor-matches` (menti → mentör) uçlarının döndürdüğü SIRA,
 * ürün niyetini karşılıyor mu? Kesin skor değil, "kim kimden önde / kim hiç yok" iddiaları.
 *
 * Kurum barajı (minMatchScoreThreshold, varsayılan 50) sıralama iddialarında 0'a çekilir;
 * aksi hâlde düşük skorlu aday baraja takılıp listeden düşer ve "önde mi" sorusu
 * boş karşılaştırmaya dönüşür (bkz. PS-08 — koşullu test tuzağı).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

type CandidateItem = { mentiId: string; totalScore: number };
type MentorMatchItem = { mentorId: string; matchScore: number };

async function withoutThreshold(tenant: Tenant): Promise<void> {
  await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: 0 } });
}

/** `ids` içinde `a`, `b`'den önce mi — ikisi de listede olmak ZORUNDA. */
function expectBefore(ids: string[], a: string, b: string): void {
  expect(ids, 'önde olması beklenen aday listede yok').toContain(a);
  expect(ids, 'geride olması beklenen aday listede yok').toContain(b);
  expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
}

describe('PS-07 · Mentor → menti aday sıralaması', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    await withoutThreshold(tenant);
  });

  async function candidatesOf(mentor: { id: string; email: string; rawPassword: string }, t: Tenant = tenant) {
    const { accessToken } = await loginAs(http, mentor.email, mentor.rawPassword);
    const res = await http
      .get(`/api/mentors/${mentor.id}/candidates`)
      .set(tenantHeaders(t.id, accessToken))
      .expect(200);
    return (res.body as { items: CandidateItem[] }).items;
  }

  it('aynı sektörü paylaşan menti, hiç paylaşmayandan önde (DISC eşit)', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const other = await createMenti(tenant.id, { discType: 'D', sectorTags: ['saglik'] });
    const shared = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const ids = (await candidatesOf(mentor)).map((i) => i.mentiId);
    expectBefore(ids, shared.id, other.id);
  });

  it('sektör eşitken DISC uyumu yüksek olan menti önde (C mentor: D menti > S menti)', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const lowDisc = await createMenti(tenant.id, { discType: 'S', sectorTags: ['teknoloji'] });
    const highDisc = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const ids = (await candidatesOf(mentor)).map((i) => i.mentiId);
    expectBefore(ids, highDisc.id, lowDisc.id);
  });

  it('sektör karakterden baskın: tam sektör + zayıf DISC, sıfır sektör + güçlü DISC\'in önünde', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const discOnly = await createMenti(tenant.id, { discType: 'D', sectorTags: ['saglik'] });   // C→D 85
    const sectorOnly = await createMenti(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] }); // C→C 60

    const ids = (await candidatesOf(mentor)).map((i) => i.mentiId);
    expectBefore(ids, sectorOnly.id, discOnly.id);
  });

  it('uyumlu adaylar varken anti-match menti (D mentor → S menti) listede yer almaz', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    const antiMatch = await createMenti(tenant.id, { discType: 'S', sectorTags: ['teknoloji'] });
    const compatible = await createMenti(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });

    const ids = (await candidatesOf(mentor)).map((i) => i.mentiId);
    expect(ids).toContain(compatible.id);
    expect(ids).not.toContain(antiMatch.id);
  });

  it('dönen liste skora göre azalan sırada ve en az iki aday içeriyor', async () => {
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji', 'finans'] });
    await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    await createMenti(tenant.id, { discType: 'S', sectorTags: ['finans', 'sanat'] });
    await createMenti(tenant.id, { discType: 'I', sectorTags: ['saglik'] });

    const items = await candidatesOf(mentor);
    expect(items.length).toBeGreaterThanOrEqual(2);
    const scores = items.map((i) => i.totalScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('mentor kendi aday listesinde asla yer almaz (başka kurumda menti üyeliği olsa bile)', async () => {
    // Paylaşımlı havuzdaki iki kurum: kişi A kurumunda MENTOR, B kurumunda MENTI.
    // A kurumunda kendi aday listesini açtığında KENDİSİNİ görmemeli.
    const tenantA = await createTenant({ isSharedPoolActive: true });
    const tenantB = await createTenant({ isSharedPoolActive: true });
    await withoutThreshold(tenantA);

    const mentor = await createMentor(tenantA.id, { discType: 'C', sectorTags: ['teknoloji'] });
    await testPrisma.tenantMembership.create({
      data: { userId: mentor.id, tenantId: tenantB.id, role: 'MENTI', isActive: true },
    });
    // Referans aday — liste boş dönüp testi boşuna geçirmesin.
    const realMenti = await createMenti(tenantA.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const ids = (await candidatesOf(mentor, tenantA)).map((i) => i.mentiId);
    expect(ids).toContain(realMenti.id);
    expect(ids).not.toContain(mentor.id);
  });

  it('paylaşım kapalıyken başka kurumun (skoru daha yüksek) adayı listede yok', async () => {
    const other = await createTenant({ isSharedPoolActive: false });
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const own = await createMenti(tenant.id, { discType: 'S', sectorTags: ['saglik'] });         // düşük skor
    const foreign = await createMenti(other.id, { discType: 'D', sectorTags: ['teknoloji'] });   // en yüksek skor

    const ids = (await candidatesOf(mentor)).map((i) => i.mentiId);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
  });

  it('paylaşım yalnız karşı kurumda açıkken de başka kurumun adayı listede yok', async () => {
    const other = await createTenant({ isSharedPoolActive: true }); // bizimki kapalı (varsayılan)
    const mentor = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });
    const own = await createMenti(tenant.id, { discType: 'S', sectorTags: ['saglik'] });
    const foreign = await createMenti(other.id, { discType: 'D', sectorTags: ['teknoloji'] });

    const ids = (await candidatesOf(mentor)).map((i) => i.mentiId);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
  });
});

describe('PS-07 · Menti → mentör uyum sıralaması', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  async function mentorMatchesOf(menti: { id: string; email: string; rawPassword: string }) {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .get(`/api/mentis/${menti.id}/mentor-matches`)
      .set(tenantHeaders(tenant.id, accessToken))
      .expect(200);
    return (res.body as { items: MentorMatchItem[] }).items;
  }

  it('aynı sektörü paylaşan mentör, hiç paylaşmayandan önde (DISC eşit)', async () => {
    const menti = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    const other = await createMentor(tenant.id, { discType: 'C', sectorTags: ['saglik'] });
    const shared = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] });

    const ids = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expectBefore(ids, shared.id, other.id);
  });

  it('sektör eşitken menti ile DISC uyumu yüksek mentör önde (D menti: C mentör > S mentör)', async () => {
    const menti = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    const lowDisc = await createMentor(tenant.id, { discType: 'S', sectorTags: ['teknoloji'] });  // S→D 35
    const highDisc = await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji'] }); // C→D 85

    const ids = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expectBefore(ids, highDisc.id, lowDisc.id);
  });

  it('menti kendi mentör listesinde asla yer almaz (başka kurumda mentör üyeliği olsa bile)', async () => {
    const tenantA = await createTenant({ isSharedPoolActive: true });
    const tenantB = await createTenant({ isSharedPoolActive: true });
    tenant = tenantA;

    const menti = await createMenti(tenantA.id, { discType: 'D', sectorTags: ['teknoloji'] });
    await testPrisma.tenantMembership.create({
      data: { userId: menti.id, tenantId: tenantB.id, role: 'MENTOR', isActive: true },
    });
    const realMentor = await createMentor(tenantA.id, { discType: 'C', sectorTags: ['teknoloji'] });

    const ids = (await mentorMatchesOf(menti)).map((i) => i.mentorId);
    expect(ids).toContain(realMentor.id);
    expect(ids).not.toContain(menti.id);
  });
});
