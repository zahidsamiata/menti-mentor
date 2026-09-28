/**
 * AJ-32 · U-19 — "profil satırı VAR ama çekirdek EKSİK" mentör dalı, DB'siz birim testi.
 *
 * Neden: `mentor-bookable-status.test.ts` yalnız "UserProfile HİÇ YOK" (catch → false) dalını
 * ölçüyor. Profil satırı olan ama arketip/sektör/yetenek eksik mentörün soluk gösterilmesi
 * (KARAR-80/M7) `matching.ts`'teki `return result.coreComplete` satırına dayanıyor ve bu satır
 * `return true` yapılsa hiçbir test kırılmıyordu (bitti-dogrulama-2026-09-27 · U-19 ⚠️).
 *
 * Burada `computeProfileCompleteness` MOCK'LANMAZ — gerçek `isCoreComplete` kuralı çalışır;
 * yalnız prisma katmanı sahte veriyle beslenir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type ProfileRow = {
  id: string;
  archetype: string | null;
  industryCode: string | null;
  skillTags: string[];
  profileSource: string;
};

const profilesByUser = new Map<string, ProfileRow>();
const userFindMany = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => ({
        id: 'menti-1',
        tenantId: 't1',
        sectorTags: ['tech'],
        discType: 'D',
        discVector: null,
      })),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ blockedPairs: [], minMatchScoreThreshold: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Tüm mentörlerin aktif bloğu var → soluklaşmanın TEK sebebi profil olsun.
    availabilityBlock: {
      groupBy: vi.fn(async (args: { where: { userId: { in: string[] } } }) =>
        args.where.userId.in.map((userId) => ({ userId, _count: 1 })),
      ),
    },
    userProfile: {
      findFirst: vi.fn(async (args: { where: { userId: string } }) =>
        profilesByUser.get(args.where.userId) ?? null,
      ),
    },
    matchFeedback: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock('../src/services/algorithmTuner.js', () => ({
  getAlgorithmWeights: vi.fn().mockResolvedValue({ sectorWeight: 0.6, discWeight: 0.4 }),
}));

import { rankMentorsForMenti } from '../src/services/matching.js';
import { computeProfileCompleteness } from '../src/services/profile-completeness.service.js';

function mentor(id: string) {
  return {
    id,
    tenantId: 't1',
    fullName: `Mentör ${id}`,
    avatarUrl: null,
    sectorTags: ['tech'],
    discType: 'I',
    skills: [],
    mentorVisibilityEnabled: true,
    memberships: [], // AJ-66: sertifikalı üyelik yok (iç içe select şekli)
  };
}

function profile(over: Partial<ProfileRow>): ProfileRow {
  return {
    id: 'p',
    archetype: 'Kaşif',
    industryCode: 'TECH',
    skillTags: ['react'],
    profileSource: 'ONBOARDING',
    ...over,
  };
}

describe('AJ-32 · U-19 — çekirdeği eksik profil satırı', () => {
  beforeEach(() => {
    profilesByUser.clear();
    userFindMany.mockReset();
  });

  it('computeProfileCompleteness: arketip / sektör / yetenek eksikse coreComplete:false', async () => {
    profilesByUser.set('tam', profile({}));
    profilesByUser.set('arketipsiz', profile({ archetype: null }));
    profilesByUser.set('sektorsuz', profile({ industryCode: null }));
    profilesByUser.set('yeteneksiz', profile({ skillTags: [] }));

    expect((await computeProfileCompleteness('tam', 't1')).coreComplete).toBe(true);
    expect((await computeProfileCompleteness('arketipsiz', 't1')).coreComplete).toBe(false);
    expect((await computeProfileCompleteness('sektorsuz', 't1')).coreComplete).toBe(false);
    expect((await computeProfileCompleteness('yeteneksiz', 't1')).coreComplete).toBe(false);
  });

  it('rankMentorsForMenti: profil satırı olup çekirdeği eksik mentör SOLUK görünür, listeden düşmez', async () => {
    profilesByUser.set('tam', profile({}));
    profilesByUser.set('arketipsiz', profile({ archetype: null }));
    profilesByUser.set('yeteneksiz', profile({ skillTags: [] }));
    userFindMany.mockResolvedValueOnce([mentor('arketipsiz'), mentor('tam'), mentor('yeteneksiz')]);

    const { items } = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: 't1' });
    const byId = new Map(items.map((i) => [i.mentorId, i]));

    // KARAR-80/M7: kart kalır (gizlenmez).
    expect([...byId.keys()].sort()).toEqual(['arketipsiz', 'tam', 'yeteneksiz']);

    expect(byId.get('tam')!.isProfileFaded).toBe(false);
    expect(byId.get('tam')!.isFaded).toBe(false);

    for (const id of ['arketipsiz', 'yeteneksiz']) {
      expect(byId.get(id)!.isProfileFaded, `${id}: çekirdek eksik → soluk olmalı`).toBe(true);
      expect(byId.get(id)!.isFaded, `${id}: çekirdek eksik → isFaded`).toBe(true);
    }
  });
});
