/**
 * PS-01 · Kararlı sıralama — DB'siz birim.
 * Aday sorgusu `orderBy: { id: 'asc' }` taşır; DB eşit skorlu adayları karışık sırada
 * döndürse bile sonuç skor azalan + eşitlikte id artan olur.
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

import { rankMentisForMentor, rankMentorsForMenti } from '../src/services/matching.js';

function person(id: string, sectorTags: string[]) {
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
  };
}

describe('PS-01 · kararlı sıralama (birim)', () => {
  beforeEach(() => userFindMany.mockReset());

  it('rankMentisForMentor: sorgu id artan orderBy taşır; eşit skorda id artan', async () => {
    userFindMany.mockResolvedValue([
      person('c', ['teknoloji']),
      person('z', ['saglik']),
      person('a', ['teknoloji']),
      person('b', ['teknoloji']),
    ]);
    const { items } = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });

    expect(userFindMany.mock.calls[0]![0]).toMatchObject({ orderBy: { id: 'asc' }, take: 500 });
    expect(items.map((m) => m.mentiId)).toEqual(['a', 'b', 'c', 'z']);
    expect(items[0]!.totalScore).toBeGreaterThan(items[3]!.totalScore);
  });

  it('rankMentorsForMenti: sorgu id artan orderBy taşır; eşit skorda id artan', async () => {
    userFindMany.mockResolvedValue([
      person('m3', ['teknoloji']),
      person('m1', ['teknoloji']),
      person('m9', ['saglik']),
      person('m2', ['teknoloji']),
    ]);
    const { items } = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1' });

    expect(userFindMany.mock.calls[0]![0]).toMatchObject({ orderBy: { id: 'asc' }, take: 500 });
    expect(items.map((m) => m.mentorId)).toEqual(['m1', 'm2', 'm3', 'm9']);
  });

  it('girdi sırası ne olursa olsun çıktı aynı', async () => {
    const pool = ['d', 'a', 'c', 'b'].map((id) => person(id, ['teknoloji']));
    userFindMany.mockResolvedValueOnce(pool).mockResolvedValueOnce([...pool].reverse());
    const r1 = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });
    const r2 = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });
    expect(r1.items.map((m) => m.mentiId)).toEqual(r2.items.map((m) => m.mentiId));
    expect(r1.items.map((m) => m.mentiId)).toEqual(['a', 'b', 'c', 'd']);
  });
});
