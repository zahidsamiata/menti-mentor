/**
 * Y1-B9b · Askıdaki kurum paylaşımlı havuzdan düşer — DB'siz birim.
 * Aday kurum listesi (buildEligibleTenantIds) iki yönde de askı kuralını (isTenantSuspended) uygular;
 * aday sorgusu bu listeyle filtrelenir. Kararlı sıra (PS-01) ve take:500 değişmez.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const userFindMany = vi.fn();
const tenantFindMany = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => ({
        id: args.where.id,
        tenantId: 'A',
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
      findMany: (...a: unknown[]) => tenantFindMany(...a),
    },
    mentorFilter: { findUnique: vi.fn().mockResolvedValue(null) },
    feedback: { findMany: vi.fn().mockResolvedValue([]) },
    availabilityBlock: { groupBy: vi.fn().mockResolvedValue([]) },
    userProfile: { findFirst: vi.fn().mockResolvedValue(null) },
    matchFeedback: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock('../src/services/algorithmTuner.js', () => ({
  getAlgorithmWeights: vi.fn().mockResolvedValue({ sectorWeight: 0.6, discWeight: 0.4 }),
}));

import {
  buildEligibleTenantIds,
  rankMentisForMentor,
  rankMentorsForMenti,
} from '../src/services/matching.js';

const active = (id: string) => ({ id, isActive: true, verificationStatus: 'APPROVED' as const });
const frozen = (id: string) => ({ id, isActive: false, verificationStatus: 'APPROVED' as const });
const rejected = (id: string) => ({ id, isActive: true, verificationStatus: 'REJECTED' as const });

describe('Y1-B9b · buildEligibleTenantIds', () => {
  it('dondurulmuş ve reddedilmiş havuz kurumları düşer; aktif havuz kurumu kalır', () => {
    expect(buildEligibleTenantIds('A', [active('A'), active('B'), frozen('C'), rejected('D')])).toEqual(['A', 'B']);
  });

  it('inceleme/düzeltme bekleyen kurum askı sayılmaz (Y1-B9 kuralıyla aynı)', () => {
    const pending = { id: 'P', isActive: true, verificationStatus: 'PENDING_REVIEW' as const };
    const correction = { id: 'K', isActive: true, verificationStatus: 'CORRECTION_REQUESTED' as const };
    expect(buildEligibleTenantIds('A', [active('A'), pending, correction])).toEqual(['A', 'P', 'K']);
  });

  it('istek kurumu havuzda değilse yalnız kendisi (mevcut davranış)', () => {
    expect(buildEligibleTenantIds('A', [active('B'), active('C')])).toEqual(['A']);
  });

  it('istek kurumu askıdaysa başka kurumların adaylarına açılmaz; kendisi listede kalır', () => {
    expect(buildEligibleTenantIds('A', [frozen('A'), active('B')])).toEqual(['A']);
  });
});

describe('Y1-B9b · aday sorgusu askıdaki kurumu içermez', () => {
  beforeEach(() => {
    userFindMany.mockReset().mockResolvedValue([]);
    tenantFindMany.mockReset().mockResolvedValue([active('A'), active('B'), frozen('C'), rejected('D')]);
  });

  it('rankMentisForMentor: askı alanları okunur; aday kurumları A,B; orderBy/take değişmez', async () => {
    await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 'A' });
    expect(tenantFindMany.mock.calls[0]![0]).toMatchObject({
      where: { isSharedPoolActive: true },
      select: { id: true, isActive: true, verificationStatus: true },
    });
    expect(userFindMany.mock.calls[0]![0]).toMatchObject({
      where: {
        tenantId: { in: ['A', 'B'] },
        memberships: { some: { tenantId: { in: ['A', 'B'] }, role: 'MENTI', isActive: true } },
      },
      orderBy: { id: 'asc' },
      take: 500,
    });
  });

  it('rankMentorsForMenti: aday kurumları A,B; orderBy/take değişmez', async () => {
    await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 'A' });
    expect(userFindMany.mock.calls[0]![0]).toMatchObject({
      where: {
        tenantId: { in: ['A', 'B'] },
        memberships: { some: { tenantId: { in: ['A', 'B'] }, role: 'MENTOR', isActive: true } },
      },
      orderBy: { id: 'asc' },
      take: 500,
    });
  });
});
