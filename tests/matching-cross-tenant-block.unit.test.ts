/**
 * AJ-28 (KR-19 kalanı) · Kurumlar arası havuzda karşı kurumun yöneticisinin koyduğu çift engeli
 * aday LİSTESİNDE de uygulanır — DB'siz birim.
 *
 * Kurgu: X kurum A'da, Y kurum B'de; A ve B paylaşımlı havuzda. Kurum B yöneticisi X–Y çiftini
 * engelledi (blok B'nin blockedPairs'ında; A'nın listesi boş). Eylem uçları (KR-19b
 * isPairBlockedInTenants) iki tarafın kurumunu okuduğu için X–Y zaten mesajlaşamaz/istek atamaz;
 * liste de aynı kurala uymalı: X listede Y'yi görmez, Y listede X'i görmez.
 * Kontrol adayı (Z, kurum B) engelsiz → listede kalır (filtre her şeyi silmiyor).
 * Negatif sınır: üçüncü kurum C'nin listesindeki X–Y bloğu sayılmaz (eylem uçları C'yi okumaz).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const tenantFindUnique = vi.fn();
const tenantFindMany = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...a),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    tenant: {
      findUnique: (...a: unknown[]) => tenantFindUnique(...a),
      findMany: (...a: unknown[]) => tenantFindMany(...a),
    },
    mentorFilter: { findUnique: vi.fn().mockResolvedValue(null) },
    feedback: { findMany: vi.fn().mockResolvedValue([]) },
    availabilityBlock: { groupBy: vi.fn().mockResolvedValue([]) },
    matchFeedback: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock('../src/services/algorithmTuner.js', () => ({
  getAlgorithmWeights: vi.fn().mockResolvedValue({ sectorWeight: 0.6, discWeight: 0.4 }),
}));

vi.mock('../src/services/profile-completeness.service.js', () => ({
  computeProfileCompleteness: vi.fn().mockResolvedValue({ coreComplete: true }),
}));

import { rankMentisForMentor, rankMentorsForMenti } from '../src/services/matching.js';
import { buildListBlockedSet } from '../src/services/blockList.js';

const X = 'user-x'; // kurum A
const Y = 'user-y'; // kurum B
const Z = 'user-z'; // kurum B (engelsiz kontrol)

const pool = (id: string, blockedPairs: unknown[] = []) => ({
  id, isActive: true, verificationStatus: 'APPROVED' as const, blockedPairs,
});
const blockXY = [{ fromUserId: X, toUserId: Y, blockedAt: '2026-09-27T00:00:00.000Z', blockedBy: 'admin-b' }];

function profile(id: string, tenantId: string) {
  return {
    id, tenantId, fullName: `Aday ${id}`, avatarUrl: null,
    sectorTags: ['teknoloji'], discType: 'C', discVector: null, skills: [],
    mentorVisibilityEnabled: true, timeCommitment: null, interactionStyle: null, expectationCategories: [],
    memberships: [], // AJ-66: sertifikalı üyelik yok (iç içe select şekli)
  };
}

describe('AJ-28 · kurumlar arası havuz — karşı kurumun çift engeli listede de geçerli', () => {
  beforeEach(() => {
    userFindFirst.mockReset();
    userFindMany.mockReset();
    tenantFindUnique.mockReset().mockResolvedValue({ blockedPairs: [], minMatchScoreThreshold: 0 });
    // Engel YALNIZ kurum B'nin listesinde; kurum A (çağıranın kurumu) listesi boş.
    tenantFindMany.mockReset().mockResolvedValue([pool('A'), pool('B', blockXY)]);
  });

  it('menti X (kurum A) mentör listesinde, kurum B yöneticisinin engellediği Y görünmez; engelsiz Z görünür', async () => {
    userFindFirst.mockResolvedValue(profile(X, 'A'));
    userFindMany.mockResolvedValueOnce([profile(Y, 'B'), profile(Z, 'B')]).mockResolvedValue([]);

    const { items } = await rankMentorsForMenti({ mentiId: X, mentiTenantId: 'A' });

    const ids = items.map((m) => m.mentorId);
    expect(ids).not.toContain(Y);
    expect(ids).toContain(Z);
  });

  it('mentör X (kurum A) menti listesinde, kurum B yöneticisinin engellediği Y görünmez; engelsiz Z görünür', async () => {
    userFindFirst.mockResolvedValue(profile(X, 'A'));
    userFindMany.mockResolvedValueOnce([profile(Y, 'B'), profile(Z, 'B')]).mockResolvedValue([]);

    const { items } = await rankMentisForMentor({ mentorId: X, mentorTenantId: 'A' });

    const ids = items.map((m) => m.mentiId);
    expect(ids).not.toContain(Y);
    expect(ids).toContain(Z);
  });

  it('karşı yön: menti Y (kurum B) listesinde kendi kurumunun engeli nedeniyle X (kurum A) görünmez', async () => {
    tenantFindUnique.mockResolvedValue({ blockedPairs: blockXY, minMatchScoreThreshold: 0 });
    userFindFirst.mockResolvedValue(profile(Y, 'B'));
    userFindMany.mockResolvedValueOnce([profile(X, 'A')]).mockResolvedValue([]);

    const { items } = await rankMentorsForMenti({ mentiId: Y, mentiTenantId: 'B' });

    expect(items.map((m) => m.mentorId)).not.toContain(X);
  });
});

describe('AJ-28 · buildListBlockedSet — eylem uçlarıyla aynı kural (saf)', () => {
  it('çağıranın kurumu ya da adayın kendi kurumu engellediyse aday kümede', () => {
    const set = buildListBlockedSet(X, [], [pool('A'), pool('B', blockXY)], [
      { id: Y, tenantId: 'B' }, { id: Z, tenantId: 'B' },
    ]);
    expect([...set]).toEqual([Y]);
  });

  it('üçüncü kurum (C) listesindeki engel sayılmaz — eylem uçları yalnız iki tarafın kurumunu okur', () => {
    const set = buildListBlockedSet(X, [], [pool('A'), pool('B'), pool('C', blockXY)], [
      { id: Y, tenantId: 'B' },
    ]);
    expect(set.has(Y)).toBe(false);
  });

  it('çağıranın kurumunun engeli (mevcut KR-19 davranışı) korunur', () => {
    const set = buildListBlockedSet(X, blockXY, [], [{ id: Y, tenantId: 'B' }]);
    expect(set.has(Y)).toBe(true);
  });
});
