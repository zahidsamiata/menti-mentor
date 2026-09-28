/**
 * AJ-93 (S35 / madde 171) · Kurum özel ağırlığı SIRALAMAYI gerçekten değiştiriyor mu — DB'siz birim.
 *
 * Mevcut testler ağırlığın kaydedildiğini/doğrulandığını (algorithm-weights-manual*) ve saf skor
 * formülünü (scoring.unit.test.ts) ölçüyor; motorun kurumun ağırlığını OKUYUP sırayı değiştirdiğini
 * ölçen test yoktu. Burada gerçek sıralama fonksiyonları (rankMentisForMentor / rankMentorsForMenti)
 * çağrılır; yalnız prisma ve ağırlık okuyucu (getAlgorithmWeights) sahtedir.
 *
 * Aynı iki aday, iki kurum:
 *   - SEKTOR_AGIR kurumu: sektör 0.70 / karakter 0.30 → sektör uyumlu aday önde
 *   - KARAKTER_AGIR kurumu: sektör 0.40 / karakter 0.60 → DISC uyumlu aday önde
 * (0.40 ve 0.70 algorithmTuner'daki MIN/MAX_SECTOR_WEIGHT sınırlarıdır.)
 * Varsayılan 0.6/0.4'te sektör uyumlu aday önde kalır → ağırlık okuma satırı sabit varsayılana
 * çevrilirse "karakter ağır" testleri kırmızı olur (mutasyon kanıtı).
 *
 * Skor hesabı (DISC_COMPATIBILITY: S satırı D=35 S=75 · C satırı D=85 · S→D=35):
 *   mentör→menti (mentör S, etiket teknoloji):
 *     A = sektör 100, DISC 35 (menti D) · B = sektör 50, DISC 75 (menti S)
 *     0.70/0.30 → A 80.5, B 57.5   ·   0.40/0.60 → A 61, B 65
 *   menti→mentör (menti D, etiket teknoloji+finans):
 *     A = sektör 100, DISC 35 (mentör S) · B = sektör 50, DISC 85 (mentör C)
 *     0.70/0.30 → A 80.5, B 60.5   ·   0.40/0.60 → A 61, B 71
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SEKTOR_AGIR_TENANT = 'tenant-sektor-agir';
const KARAKTER_AGIR_TENANT = 'tenant-karakter-agir';

const WEIGHTS_BY_TENANT: Record<string, { sectorWeight: number; discWeight: number }> = {
  [SEKTOR_AGIR_TENANT]: { sectorWeight: 0.7, discWeight: 0.3 },
  [KARAKTER_AGIR_TENANT]: { sectorWeight: 0.4, discWeight: 0.6 },
};

const userFindFirst = vi.fn();
const userFindMany = vi.fn();
const getAlgorithmWeights = vi.fn(async (tenantId: string) => {
  const w = WEIGHTS_BY_TENANT[tenantId];
  if (!w) throw new Error(`beklenmeyen kurum: ${tenantId}`);
  return { ...w, lastAdjustedAt: null, reason: null };
});

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...a),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    tenant: {
      // Eşik 0 → eşik/fallback sırayı etkilemez; ölçülen tek değişken ağırlık.
      findUnique: vi.fn().mockResolvedValue({ minMatchScoreThreshold: 0, blockedPairs: [] }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    mentorFilter: { findUnique: vi.fn().mockResolvedValue(null) },
    feedback: { findMany: vi.fn().mockResolvedValue([]) }, // kalite katsayısı nötr (1.0)
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
  getAlgorithmWeights: (tenantId: string) => getAlgorithmWeights(tenantId),
}));

import { rankMentisForMentor, rankMentorsForMenti } from '../src/services/matching.js';

function candidate(id: string, sectorTags: string[], discType: 'D' | 'I' | 'S' | 'C', tenantId: string) {
  return {
    id,
    fullName: `Aday ${id}`,
    tenantId,
    sectorTags,
    discType,
    discVector: null, // vektörsüz → klasik DISC matrisi (hesap yukarıdaki yorumla birebir)
    skills: [],
    avatarUrl: null,
    timeCommitment: null,
    interactionStyle: null,
    expectationCategories: [],
    mentorVisibilityEnabled: true,
    memberships: [],
  };
}

describe('AJ-93 · kurum ağırlığı sıralamayı değiştirir — mentör → menti (rankMentisForMentor)', () => {
  // A: sektör uyumlu (100), DISC zayıf (mentör S ↔ menti D = 35)
  // B: sektör yarım (50), DISC uyumlu (mentör S ↔ menti S = 75)
  const pool = (tenantId: string) => [
    candidate('menti-a-sektor', ['teknoloji'], 'D', tenantId),
    candidate('menti-b-disc', ['teknoloji', 'saglik'], 'S', tenantId),
  ];

  beforeEach(() => {
    userFindMany.mockReset();
    getAlgorithmWeights.mockClear();
    userFindFirst.mockReset();
    userFindFirst.mockImplementation(async (args: { where: { id: string; tenantId: string } }) => ({
      id: args.where.id,
      tenantId: args.where.tenantId,
      sectorTags: ['teknoloji'],
      discType: 'S',
      timeCommitment: null,
      interactionStyle: null,
      expectationCategories: [],
    }));
  });

  it('sektör ağır kurum (0.70/0.30): sektör uyumlu aday önde', async () => {
    userFindMany.mockResolvedValue(pool(SEKTOR_AGIR_TENANT));
    const { items, fallbackLevel } = await rankMentisForMentor({ mentorId: 'mentor-1', mentorTenantId: SEKTOR_AGIR_TENANT });

    expect(getAlgorithmWeights).toHaveBeenCalledWith(SEKTOR_AGIR_TENANT);
    expect(fallbackLevel).toBe(0);
    expect(items.map((m) => m.mentiId)).toEqual(['menti-a-sektor', 'menti-b-disc']);
    expect(items.map((m) => m.totalScore)).toEqual([80.5, 57.5]);
  });

  it('karakter ağır kurum (0.40/0.60): AYNI iki adayda DISC uyumlu aday önde', async () => {
    userFindMany.mockResolvedValue(pool(KARAKTER_AGIR_TENANT));
    const { items, fallbackLevel } = await rankMentisForMentor({ mentorId: 'mentor-1', mentorTenantId: KARAKTER_AGIR_TENANT });

    expect(getAlgorithmWeights).toHaveBeenCalledWith(KARAKTER_AGIR_TENANT);
    expect(fallbackLevel).toBe(0);
    expect(items.map((m) => m.mentiId)).toEqual(['menti-b-disc', 'menti-a-sektor']);
    expect(items.map((m) => m.totalScore)).toEqual([65, 61]);
  });
});

describe('AJ-93 · kurum ağırlığı sıralamayı değiştirir — menti → mentör (rankMentorsForMenti)', () => {
  // A: sektör uyumlu (100), DISC zayıf (mentör S ↔ menti D = 35)
  // B: sektör yarım (50), DISC uyumlu (mentör C ↔ menti D = 85)
  const pool = (tenantId: string) => [
    candidate('mentor-a-sektor', ['teknoloji', 'finans'], 'S', tenantId),
    candidate('mentor-b-disc', ['teknoloji'], 'C', tenantId),
  ];

  beforeEach(() => {
    userFindMany.mockReset();
    getAlgorithmWeights.mockClear();
    userFindFirst.mockReset();
    userFindFirst.mockImplementation(async (args: { where: { id: string; tenantId: string } }) => ({
      id: args.where.id,
      tenantId: args.where.tenantId,
      sectorTags: ['teknoloji', 'finans'],
      discType: 'D',
      discVector: null,
    }));
  });

  it('sektör ağır kurum (0.70/0.30): sektör uyumlu mentör önde', async () => {
    userFindMany.mockResolvedValue(pool(SEKTOR_AGIR_TENANT));
    const { items } = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: SEKTOR_AGIR_TENANT });

    expect(getAlgorithmWeights).toHaveBeenCalledWith(SEKTOR_AGIR_TENANT);
    expect(items.map((m) => m.mentorId)).toEqual(['mentor-a-sektor', 'mentor-b-disc']);
    expect(items.map((m) => m.totalScore)).toEqual([80.5, 60.5]);
  });

  it('karakter ağır kurum (0.40/0.60): AYNI iki mentörde DISC uyumlu mentör önde', async () => {
    userFindMany.mockResolvedValue(pool(KARAKTER_AGIR_TENANT));
    const { items } = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: KARAKTER_AGIR_TENANT });

    expect(getAlgorithmWeights).toHaveBeenCalledWith(KARAKTER_AGIR_TENANT);
    expect(items.map((m) => m.mentorId)).toEqual(['mentor-b-disc', 'mentor-a-sektor']);
    expect(items.map((m) => m.totalScore)).toEqual([71, 61]);
  });
});
