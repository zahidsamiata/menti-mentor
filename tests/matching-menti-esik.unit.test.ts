/**
 * PS-A4 · KARAR-6 ek(1) — menti alt uyum eşiği, DB'siz birim testi.
 *
 * `matching-menti-esik.test.ts` (entegrasyon) aynı iddiaları gerçek DB ile doğrular; bu dosya
 * aynı davranışı prisma/db bağımlılığı olmadan hızlı çalıştırmak için mock'lanmış servis
 * katmanıyla tekrarlar (CI'da TEST_DATABASE_URL'siz de koşar).
 *
 * Skor kurgusu — gerçek scoring.ts formülü (sektör %60 / DISC %40) kullanılır, mock YOK:
 *   - menti: discType 'D', sectorTags ['t1','t2']
 *   - "dusuk" aday: discType 'D', sectorTags ['t1']  → sektör 50 + DISC(D→D=60) → totalScore 54
 *   - "yuksek" aday: discType 'C', sectorTags ['t1'] → sektör 50 + DISC(C→D=85) → totalScore 64
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const userFindMany = vi.fn();
const tenantFindUnique = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => ({
        id: 'menti-1',
        tenantId: 't1',
        sectorTags: ['t1', 't2'],
        discType: 'D',
        discVector: null,
      })),
      findMany: (...a: unknown[]) => userFindMany(...a),
    },
    tenant: {
      findUnique: (...a: unknown[]) => tenantFindUnique(...a),
      findMany: vi.fn().mockResolvedValue([]), // paylaşımlı havuz yok
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

function mentor(id: string, discType: 'D' | 'I' | 'S' | 'C', sectorTags: string[]) {
  return {
    id,
    tenantId: 't1',
    fullName: `Mentör ${id}`,
    avatarUrl: null,
    sectorTags,
    discType,
    skills: [],
    mentorVisibilityEnabled: true,
    memberships: [], // AJ-66: sertifikalı üyelik yok (iç içe select şekli)
  };
}

const dusuk  = mentor('dusuk', 'D', ['t1']);  // totalScore 54
const yuksek = mentor('yuksek', 'C', ['t1']); // totalScore 64

describe('PS-A4 · rankMentorsForMenti — alt uyum eşiği (birim)', () => {
  beforeEach(() => {
    userFindMany.mockReset();
    tenantFindUnique.mockReset();
  });

  it('eşik altındaki mentör listede yok (eşik 60 → 54 dışlanır, 64 kalır)', async () => {
    tenantFindUnique.mockResolvedValue({ blockedPairs: [], minMatchScoreThreshold: 60 });
    userFindMany.mockResolvedValueOnce([dusuk, yuksek]);

    const { items } = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: 't1' });

    expect(items.map((m) => m.mentorId)).toEqual(['yuksek']);
    expect(items.find((m) => m.mentorId === 'yuksek')!.totalScore).toBe(64);
  });

  it('kurum eşiği değişince liste değişir — sabit sayı YOK', async () => {
    tenantFindUnique.mockResolvedValueOnce({ blockedPairs: [], minMatchScoreThreshold: 60 });
    userFindMany.mockResolvedValueOnce([dusuk, yuksek]);
    const strict = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: 't1' });
    expect(strict.items.map((m) => m.mentorId)).toEqual(['yuksek']);

    tenantFindUnique.mockResolvedValueOnce({ blockedPairs: [], minMatchScoreThreshold: 40 });
    userFindMany.mockResolvedValueOnce([dusuk, yuksek]);
    const loose = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: 't1' });
    expect(loose.items.map((m) => m.mentorId).sort()).toEqual(['dusuk', 'yuksek']);
  });

  it('fallback: hiç aday eşiği geçmiyorsa (küçük kurum) eşik atlanır — liste boş dönmez', async () => {
    tenantFindUnique.mockResolvedValueOnce({ blockedPairs: [], minMatchScoreThreshold: 90 });
    userFindMany.mockResolvedValueOnce([dusuk, yuksek]);

    const { items } = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: 't1' });

    expect(items.map((m) => m.mentorId).sort()).toEqual(['dusuk', 'yuksek']);
  });

  it('eşik tanımsızsa (tenant kaydı yoksa) filtre uygulanmaz', async () => {
    tenantFindUnique.mockResolvedValueOnce({ blockedPairs: [], minMatchScoreThreshold: undefined });
    userFindMany.mockResolvedValueOnce([dusuk, yuksek]);

    const { items } = await rankMentorsForMenti({ mentiId: 'menti-1', mentiTenantId: 't1' });

    expect(items.map((m) => m.mentorId).sort()).toEqual(['dusuk', 'yuksek']);
  });
});
