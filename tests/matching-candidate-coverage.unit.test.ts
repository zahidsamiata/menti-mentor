/**
 * AN-07 · Aday kesmesi skorlamadan ÖNCE en iyi adayı kaybetmez — DB'siz birim.
 * Aday sorgusu id-artan 500'lük sayfalarla (keyset: id > son id) toplanır; hepsi skorlanır,
 * kesme skordan SONRA yapılır. 500'den kalabalık havuzda id sırasına göre 500'ün dışında
 * kalan en yüksek skorlu aday sonuçta yer alır. Menti yönünde ağır zenginleştirme
 * (müsaitlik groupBy, profil tamamlanma) yalnız döndürülen ilk N mentöre yapılır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown> & { id: string };
let pool: Row[] = [];
const userFindMany = vi.fn(async (args: { where: { id: { gt?: string } }; take: number }) => {
  const after = args.where.id.gt;
  const rows = pool
    .filter((r) => (after ? r.id > after : true))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.slice(0, args.take);
});
const groupBy = vi.fn(async (args: { where: { userId: { in: string[] } } }) =>
  args.where.userId.in.map((userId) => ({ userId, _count: 1 })),
);
const profileFindFirst = vi.fn().mockResolvedValue(null);

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
      findMany: (a: never) => userFindMany(a),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ minMatchScoreThreshold: 0, blockedPairs: [] }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    mentorFilter: { findUnique: vi.fn().mockResolvedValue(null) },
    feedback: { findMany: vi.fn().mockResolvedValue([]) },
    availabilityBlock: { groupBy: (a: never) => groupBy(a) },
    userProfile: { findFirst: (...a: unknown[]) => profileFindFirst(...a) },
    matchFeedback: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock('../src/services/algorithmTuner.js', () => ({
  getAlgorithmWeights: vi.fn().mockResolvedValue({ sectorWeight: 0.6, discWeight: 0.4 }),
}));

import {
  rankMentisForMentor,
  rankMentorsForMenti,
  MATCH_CANDIDATE_PAGE_SIZE,
  MAX_MATCH_CANDIDATES,
} from '../src/services/matching.js';

function person(id: string, sectorTags: string[]): Row {
  return {
    id,
    fullName: `Kişi ${id}`,
    tenantId: 't1',
    sectorTags,
    discType: 'D',
    discVector: null,
    skills: [],
    avatarUrl: null,
    timeCommitment: null,
    interactionStyle: null,
    expectationCategories: [],
    mentorVisibilityEnabled: true,
    memberships: [], // AJ-66: sertifikalı üyelik yok (iç içe select şekli)
  };
}

// 1200 düşük skorlu aday (id: a0000…a1199) + id sırasında EN SONDA tek yüksek skorlu aday.
const LOW_COUNT = 1200;
const BEST_ID = 'z-best';
function buildPool(): Row[] {
  const low = Array.from({ length: LOW_COUNT }, (_, i) => person(`a${String(i).padStart(4, '0')}`, ['saglik']));
  return [...low, person(BEST_ID, ['teknoloji'])];
}

describe('AN-07 · aday kesmesi skordan sonra (birim)', () => {
  beforeEach(() => {
    pool = buildPool();
    userFindMany.mockClear();
    groupBy.mockClear();
    profileFindFirst.mockClear();
  });

  it('rankMentisForMentor: id sırasında 500 dışındaki en iyi aday ilk sırada', async () => {
    const { items } = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1', limit: 10 });
    expect(items[0]!.mentiId).toBe(BEST_ID);
    // 1201 aday / 500 → 3 sayfa; ilk sayfa PS-01 sözleşmesini (orderBy id, take 500) korur.
    expect(userFindMany).toHaveBeenCalledTimes(3);
    expect(userFindMany.mock.calls[0]![0]).toMatchObject({ orderBy: { id: 'asc' }, take: MATCH_CANDIDATE_PAGE_SIZE });
    expect(userFindMany.mock.calls[1]![0].where.id).toEqual({ not: 'mentor', gt: 'a0499' });
  });

  it('rankMentorsForMenti: en iyi mentör ilk sırada; zenginleştirme yalnız ilk N için', async () => {
    const { items } = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1', limit: 5 });
    expect(items).toHaveLength(5);
    expect(items[0]!.mentorId).toBe(BEST_ID);
    expect(items[0]!.isBookable).toBe(true);
    // Müsaitlik tek toplu sorgu, yalnız döndürülen 5 mentör için.
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0]![0].where.userId.in).toEqual(items.map((m) => m.mentorId));
    // Profil tamamlanma mentör başına en fazla 5 kez (önceden tüm adaylar için).
    expect(profileFindFirst.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('küçük havuz: tek sorgu (davranış eskisiyle aynı)', async () => {
    pool = [person('b', ['teknoloji']), person('a', ['teknoloji'])];
    const { items } = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(items.map((m) => m.mentiId)).toEqual(['a', 'b']);
  });

  it('emniyet tavanı: MAX_MATCH_CANDIDATES üstünde sorgu durur', async () => {
    pool = Array.from({ length: MAX_MATCH_CANDIDATES + 700 }, (_, i) => person(`p${String(i).padStart(5, '0')}`, ['saglik']));
    await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1', limit: 1 });
    expect(userFindMany).toHaveBeenCalledTimes(MAX_MATCH_CANDIDATES / MATCH_CANDIDATE_PAGE_SIZE);
  });
});
