/**
 * AJ-66 · Menti mentör kartında "Sertifikalı ✓" — DB'siz birim.
 *
 * KARAR 4 (tasarim-kararlari-admin.md): sertifika rozeti HERKESE görünür, yalnız pozitif.
 * Kural yönetici havuzu rozetiyle AYNI (adminController adminListUsers): sertifika kişi-GENELİDİR —
 * mentörün herhangi bir kurumdaki üyeliği sertifikalıysa isCertified=true.
 *
 * Güvence altına alınanlar:
 *  - aday sorgusu sertifikayı İÇ İÇE `memberships` select'iyle okur (where isCertified:true, yalnız id).
 *  - üst düzey prisma.tenantMembership sorgusu YAPILMAZ: db.ts RLS eklentisi oraya istek kurumunun
 *    tenantId'sini enjekte eder → paylaşımlı havuzdaki başka kurum mentörünün sertifikası kaybolur.
 *  - sertifikalı üyeliği olan mentör → true; olmayan → false.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const userFindMany = vi.fn();
const membershipFindMany = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => ({
        id: args.where.id,
        tenantId: 'A',
        sectorTags: ['teknoloji'],
        discType: 'C',
        discVector: null,
      })),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    tenantMembership: { findMany: (...a: unknown[]) => membershipFindMany(...a) },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ minMatchScoreThreshold: 0, blockedPairs: [] }),
      // Kurum A ve B paylaşımlı havuzda → B'nin mentörü A'nın mentisine aday olur.
      findMany: vi.fn().mockResolvedValue([
        { id: 'A', isActive: true, verificationStatus: 'AUTO_APPROVED', blockedPairs: [] },
        { id: 'B', isActive: true, verificationStatus: 'AUTO_APPROVED', blockedPairs: [] },
      ]),
    },
    availabilityBlock: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../src/services/algorithmTuner.js', () => ({
  getAlgorithmWeights: vi.fn().mockResolvedValue({ sectorWeight: 0.6, discWeight: 0.4 }),
}));

vi.mock('../src/services/profile-completeness.service.js', () => ({
  computeProfileCompleteness: vi.fn().mockResolvedValue({ coreComplete: true }),
}));

import { rankMentorsForMenti } from '../src/services/matching.js';

function mentor(id: string, tenantId: string, certifiedMembershipIds: string[]) {
  return {
    id,
    fullName: `Kişi ${id}`,
    tenantId,
    sectorTags: ['teknoloji'],
    discType: 'D',
    skills: [],
    avatarUrl: null,
    mentorVisibilityEnabled: true,
    // İç içe select çıktısı: yalnız sertifikalı üyeliklerin id'si (bkz. matching.ts).
    memberships: certifiedMembershipIds.map((mid) => ({ id: mid })),
  };
}

describe('AJ-66 · rankMentorsForMenti — isCertified (KARAR 4, kişi-geneli)', () => {
  beforeEach(() => {
    userFindMany.mockReset();
    membershipFindMany.mockReset();
  });

  it('aday sorgusu sertifikayı iç içe memberships select ile okur; üst düzey tenantMembership sorgusu yok', async () => {
    userFindMany.mockResolvedValue([]);
    await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 'A' });

    const args = userFindMany.mock.calls[0]![0] as { select: Record<string, unknown> };
    expect(args.select['memberships']).toEqual({
      where:  { isCertified: true },
      select: { id: true },
      take:   1,
    });
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it('sertifikalı üyeliği olan mentör true, olmayan false; başka kurum (B) mentörü de kendi üyeliğinden true', async () => {
    userFindMany.mockResolvedValue([
      mentor('ayni-kurum-sertifikali', 'A', ['mem-a']),
      mentor('ayni-kurum-sertifikasiz', 'A', []),
      mentor('havuz-B-sertifikali', 'B', ['mem-b']),
    ]);
    const { items } = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 'A' });

    const byId = Object.fromEntries(items.map((i) => [i.mentorId, i.isCertified]));
    expect(byId).toEqual({
      'ayni-kurum-sertifikali':  true,
      'ayni-kurum-sertifikasiz': false,
      'havuz-B-sertifikali':     true,
    });
  });
});
