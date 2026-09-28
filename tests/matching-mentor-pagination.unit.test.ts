/**
 * AJ-90 · Menti mentör havuzu sayfalama — DB'siz birim.
 * rankMentorsForMenti offset/limit ile sayfa + total döndürür; sıra byScoreDescThenId ile kararlı
 * olduğundan ardışık sayfalar arasında tekrar/eksik olmaz — DB eşit skorluları karışık döndürse bile.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const userFindMany = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => ({
        id: args.where.id,
        tenantId: 't1',
        sectorTags: ['teknoloji'],
        discType: 'C',
        discVector: null,
        timeCommitment: null,
        interactionStyle: null,
        expectationCategories: [],
      })),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ minMatchScoreThreshold: 0, blockedPairs: [] }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    mentorFilter: { findUnique: vi.fn().mockResolvedValue(null) },
    feedback: { findMany: vi.fn().mockResolvedValue([]) },
    // AN-28: rankMentorsForMenti artık bookable/faded bayrakları için bunları okur.
    // Boş/nötr değerler döner ki bu dosyanın gerçek konusu (kararlı sıralama) etkilenmesin.
    availabilityBlock: { groupBy: vi.fn().mockResolvedValue([]) },
    userProfile: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'profile-1',
        archetype: 'Kaşif',
        industryCode: 'TECH',
        skillTags: ['react'],
        profileSource: 'MANUAL',
      }),
    },
    matchFeedback: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock('../src/services/algorithmTuner.js', () => ({
  getAlgorithmWeights: vi.fn().mockResolvedValue({ sectorWeight: 0.6, discWeight: 0.4 }),
}));

import { rankMentorsForMenti } from '../src/services/matching.js';

function mentor(id: string, sectorTags: string[]) {
  return {
    id,
    fullName: `Kişi ${id}`,
    tenantId: 't1',
    sectorTags,
    discType: 'D',
    discVector: null,
    skills: [],
    avatarUrl: null,
    mentorVisibilityEnabled: true,
  };
}

// 40 aday: yarısı menti ile ortak sektörlü (yüksek skor), yarısı değil (düşük skor) → iki eşit
// skorlu grup. DB eşit skorluları KARIŞIK sırada döndürse bile (burada ters + serpiştirilmiş)
// sayfalar kararlı olmalı: sayfa sınırında tekrar/eksik yok.
const PAGE = 18;
const ids = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}`);
const pool = ids.map((id, i) => mentor(id, i % 2 === 0 ? ['teknoloji'] : ['saglik']));
const shuffled = [...pool].reverse();

async function page(offset: number) {
  return rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1', limit: PAGE, offset });
}

describe('AJ-90 · menti mentör havuzu sayfalama (birim)', () => {
  beforeEach(() => {
    userFindMany.mockReset();
    userFindMany.mockResolvedValue(shuffled);
  });

  it('40 aday → 18/18/4; total her sayfada 40; birleşim tam, kesişim boş', async () => {
    const p1 = await page(0);
    const p2 = await page(PAGE);
    const p3 = await page(PAGE * 2);

    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([18, 18, 4]);
    for (const p of [p1, p2, p3]) expect(p.total).toBe(40);
    expect(p2.offset).toBe(PAGE);
    expect(p2.limit).toBe(PAGE);

    const all = [...p1.items, ...p2.items, ...p3.items].map((m) => m.mentorId);
    expect(new Set(all).size).toBe(40);
    expect([...all].sort()).toEqual([...ids].sort());
  });

  it('sayfalar tek istekteki tam sıranın ardışık dilimleridir (eşit skorda id artan)', async () => {
    const full = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1', limit: 200 });
    const paged = [...(await page(0)).items, ...(await page(PAGE)).items, ...(await page(PAGE * 2)).items];
    expect(paged.map((m) => m.mentorId)).toEqual(full.items.map((m) => m.mentorId));

    // Beklenen sıra: yüksek skorlu grup (çift indeks) id artan, sonra düşük skorlu grup id artan.
    const expected = [...ids.filter((_, i) => i % 2 === 0), ...ids.filter((_, i) => i % 2 === 1)];
    expect(full.items.map((m) => m.mentorId)).toEqual(expected);
    // Sayfa 1 → 2 sınırı eşit skorlu grubun ORTASINDA düşer (20 yüksek skorlu, sayfa 18).
    expect(full.items[PAGE - 1]!.totalScore).toBe(full.items[PAGE]!.totalScore);
  });

  it('offset toplamı aşarsa boş sayfa, total yine doğru', async () => {
    const p = await page(40);
    expect(p.items).toEqual([]);
    expect(p.total).toBe(40);
  });

  it('geriye uyum: offset verilmezse ilk sayfa (offset 0) döner', async () => {
    const r = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1', limit: 5 });
    expect(r.offset).toBe(0);
    expect(r.items.map((m) => m.mentorId)).toEqual(['m00', 'm02', 'm04', 'm06', 'm08']);
  });
});
