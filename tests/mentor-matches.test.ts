/**
 * Menti → Mentör uyum kartı endpoint testi (KARAR 5 güvenlik + IDOR regresyonu).
 *
 * GET /api/mentis/:mentiId/mentor-matches — menti kendisine uygun mentörleri uyum skoruyla
 * (yüzde) görür. GÜVENLİ YOL: mevcut skorlama motoru ters yönde okunur, canlı eşleştirme
 * (rankMentisForMentor) değişmez.
 *
 * Güvence altına alınan invariantlar:
 *  - KARAR 5: response mentörün discType'ını İÇERMEZ; compatibilityReason DISC harfi sızdırmaz.
 *  - Menti uyum skorunu (matchScore) GÖRÜR.
 *  - IDOR: bir menti başka menti'nin uyum listesine erişemez (requireSelfOrAdmin → 403).
 *  - AJ-90: liste sayfalı (offset/limit) + total; sayfa sınırında tekrar/eksik yok (eşit skorlu
 *    adaylar dahil); başka (havuz dışı) kurumun mentörü total'e de sayfalara da girmez.
 *  - AJ-66 · KARAR 4: kartta "Sertifikalı ✓" için isCertified — kişi-geneli (herhangi bir kurum
 *    üyeliği sertifikalıysa true, yönetici havuzu rozetiyle aynı kural); paylaşımlı havuzdaki başka
 *    kurum mentörünün sertifikası KENDİ üyeliğinden okunur; DTO'da başka yeni alan yok.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('GET /mentis/:mentiId/mentor-matches — menti uyum kartı (KARAR 5 + IDOR)', () => {
  let http: TestAgent;
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
  });

  it('menti kendi listesini çeker: skor VAR, mentörün discType YOK, gerekçe DISC harfi sızdırmaz', async () => {
    const menti  = await createMenti(tenant.id, { discType: 'D', sectorTags: ['teknoloji'] });
    await createMentor(tenant.id, { discType: 'C', sectorTags: ['teknoloji', 'finans'] });
    await createMentor(tenant.id, { discType: 'I', sectorTags: ['saglik'] });
    const tokens = await loginAs(http, menti.email, menti.rawPassword);

    const res = await http
      .get(`/api/mentis/${menti.id}/mentor-matches`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(200);

    const items = (res.body as { items: Array<Record<string, unknown>> }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      // Menti uyum skorunu görür (yüzde).
      expect(typeof item['matchScore']).toBe('number');
      // KARAR 5: mentörün DISC tipi menti response'unda ASLA olmamalı.
      expect(item).not.toHaveProperty('discType');
      expect(item).not.toHaveProperty('discScore');
      // Gerekçe jenerik — tek başına D/I/S/C harfi (DISC tipi) sızdırmamalı.
      const reason = String(item['compatibilityReason'] ?? '');
      expect(reason).not.toMatch(/\b[DISC]\b/);
    }
  });

  it('IDOR: başka bir menti, bu menti\'nin uyum listesine erişemez (403)', async () => {
    const owner   = await createMenti(tenant.id);
    const other   = await createMenti(tenant.id);
    const tokens  = await loginAs(http, other.email, other.rawPassword);

    await http
      .get(`/api/mentis/${owner.id}/mentor-matches`)
      .set(tenantHeaders(tenant.id, tokens.accessToken))
      .expect(403);
  });

  // ─── AJ-90 · sayfalama ─────────────────────────────────────────────────────
  // Skor kurgusu (bkz. matching-menti-esik.test.ts): menti D + ['t1','t2'];
  // "yuksek" C + ['t1'] → 64, "dusuk" D + ['t1'] → 54. 20+20 aday → iki EŞİT skorlu grup.
  // Sayfa 18: 1→2 sınırı yüksek grubun ortasına, 2. sayfa grup geçişine düşer.
  type PageBody = { items: Array<{ mentorId: string; matchScore: number }>; total: number; limit: number; offset: number };
  const PAGE = 18;

  async function seedFortyCandidates() {
    // Baraj 0: iki grup da listede kalsın (eşik davranışı bu testin konusu değil).
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: 0 } });
    const menti = await createMenti(tenant.id, { discType: 'D', sectorTags: ['t1', 't2'] });
    for (let i = 0; i < 20; i++) {
      await createMentor(tenant.id, { discType: 'C', sectorTags: ['t1'] });
      await createMentor(tenant.id, { discType: 'D', sectorTags: ['t1'] });
    }
    return menti;
  }

  async function fetchPage(menti: { id: string }, token: string, query: string): Promise<PageBody> {
    const res = await http
      .get(`/api/mentis/${menti.id}/mentor-matches${query}`)
      .set(tenantHeaders(tenant.id, token))
      .expect(200);
    return res.body as PageBody;
  }

  it('AJ-90: 40 aday → 18/18/4 sayfa, total 40; birleşim tam, kesişim boş, sıra tek istekle aynı', async () => {
    const menti = await seedFortyCandidates();
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    const p1 = await fetchPage(menti, accessToken, `?limit=${PAGE}`);
    const p2 = await fetchPage(menti, accessToken, `?limit=${PAGE}&offset=${PAGE}`);
    const p3 = await fetchPage(menti, accessToken, `?limit=${PAGE}&offset=${PAGE * 2}`);
    const full = await fetchPage(menti, accessToken, '?limit=200');

    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([18, 18, 4]);
    for (const p of [p1, p2, p3, full]) expect(p.total).toBe(40);
    expect([p1.offset, p2.offset, p3.offset]).toEqual([0, PAGE, PAGE * 2]);
    expect(p2.limit).toBe(PAGE);

    const paged = [...p1.items, ...p2.items, ...p3.items].map((i) => i.mentorId);
    expect(new Set(paged).size).toBe(40);
    expect(paged).toEqual(full.items.map((i) => i.mentorId));

    // Eşit skorlu adaylar: sayfa sınırı eşit skorlu grubun ortasında (tekrar/eksik yine yok).
    expect(p1.items[PAGE - 1]!.matchScore).toBe(p2.items[0]!.matchScore);
    // Skor azalan; eşit skorda mentorId artan (kararlı ikincil anahtar).
    for (let i = 1; i < full.items.length; i++) {
      const prev = full.items[i - 1]!;
      const cur = full.items[i]!;
      expect(prev.matchScore).toBeGreaterThanOrEqual(cur.matchScore);
      if (prev.matchScore === cur.matchScore) expect(prev.mentorId < cur.mentorId).toBe(true);
    }
  });

  it('AJ-90: geriye uyum — parametresiz çağrı items + total döner (offset 0)', async () => {
    const menti = await seedFortyCandidates();
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const body = await fetchPage(menti, accessToken, '');
    expect(body.items).toHaveLength(40);
    expect(body.total).toBe(40);
    expect(body.offset).toBe(0);
  });

  it('AJ-90 kurum izolasyonu: havuz dışı başka kurumun mentörü total\'e ve sayfalara girmez', async () => {
    const menti = await seedFortyCandidates();
    const otherTenant = await createTenant();
    const outsider = await createMentor(otherTenant.id, { discType: 'C', sectorTags: ['t1', 't2'] });
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);

    const pages = [
      await fetchPage(menti, accessToken, `?limit=${PAGE}`),
      await fetchPage(menti, accessToken, `?limit=${PAGE}&offset=${PAGE}`),
      await fetchPage(menti, accessToken, `?limit=${PAGE}&offset=${PAGE * 2}`),
    ];
    for (const p of pages) {
      expect(p.total).toBe(40);
      expect(p.items.map((i) => i.mentorId)).not.toContain(outsider.id);
    }
  });

  // ─── AJ-66 · Sertifikalı rozeti (KARAR 4) ──────────────────────────────────
  // Menti-facing DTO'nun TAM alan listesi — yeni alan eklenirse bilinçli güncellenmeli (sızıntı bekçisi).
  const MENTI_FACING_KEYS = [
    'compatibilityReason', 'isBookable', 'isCertified', 'isFaded', 'matchScore',
    'mentorAvatarUrl', 'mentorId', 'mentorName', 'sectorTags', 'skills',
  ];

  async function certify(userId: string, tenantId: string) {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data:  { isCertified: true, certificationStatus: 'CERTIFIED', certifiedAt: new Date() },
    });
  }

  async function fetchItems(menti: { id: string; email: string; rawPassword: string }, tenantId: string) {
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    const res = await http
      .get(`/api/mentis/${menti.id}/mentor-matches?limit=200`)
      .set(tenantHeaders(tenantId, accessToken))
      .expect(200);
    return (res.body as { items: Array<Record<string, unknown>> }).items;
  }

  it('AJ-66: sertifikalı mentör isCertified:true, sertifikasız false; DTO\'da başka yeni alan yok', async () => {
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: 0 } });
    const menti = await createMenti(tenant.id);
    const certified   = await createMentor(tenant.id);
    const uncertified = await createMentor(tenant.id);
    await certify(certified.id, tenant.id);

    const items = await fetchItems(menti, tenant.id);
    const byId = new Map(items.map((i) => [i['mentorId'], i]));
    expect(byId.get(certified.id)?.['isCertified']).toBe(true);
    expect(byId.get(uncertified.id)?.['isCertified']).toBe(false);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(MENTI_FACING_KEYS);
  });

  it('AJ-66 kurumlar arası: havuzdaki B kurumu mentörünün sertifikası KENDİ (B) üyeliğinden okunur', async () => {
    const poolA = await createTenant({ isSharedPoolActive: true });
    const poolB = await createTenant({ isSharedPoolActive: true });
    for (const t of [poolA, poolB]) {
      await testPrisma.tenant.update({ where: { id: t.id }, data: { minMatchScoreThreshold: 0 } });
    }
    const menti = await createMenti(poolA.id);
    const foreignCertified   = await createMentor(poolB.id);
    const foreignUncertified = await createMentor(poolB.id);
    await certify(foreignCertified.id, poolB.id);

    const items = await fetchItems(menti, poolA.id);
    const byId = new Map(items.map((i) => [i['mentorId'], i]));
    // Mentinin kurumunda (A) üyeliği YOK — istek kurumuna bakan bir kural burada false derdi.
    expect(byId.get(foreignCertified.id)?.['isCertified']).toBe(true);
    expect(byId.get(foreignUncertified.id)?.['isCertified']).toBe(false);
  });

  it('AJ-90 negatif: geçersiz offset (negatif / tam sayı değil) → 400', async () => {
    const menti = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, menti.email, menti.rawPassword);
    for (const bad of ['-1', 'abc', '1.5']) {
      await http
        .get(`/api/mentis/${menti.id}/mentor-matches?offset=${bad}`)
        .set(tenantHeaders(tenant.id, accessToken))
        .expect(400);
    }
  });
});
