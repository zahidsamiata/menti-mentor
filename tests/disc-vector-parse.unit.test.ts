/**
 * AJ-94 · DiscVector tip hijyeni (md.168) — DB'siz birim.
 *
 * Kök sebep: eşleştirme motoru DB'den gelen `discVector` JSON'unu doğrulamadan
 * `as DiscVector` ile kullanıyordu (matching.ts: mentör→menti aday döngüsü + menti→mentör menti
 * profili). Bozuk bir kayıt (eksik anahtar, metin, NaN) `computeDiscScore`'da NaN üretip
 * sıralamayı sessizce bozuyordu. Artık `parseDiscVector` (scoring.ts, dışa açık) tek kapıdır:
 * bozuk → null → "vektörü olmayan kullanıcı" yolu (matris). Geçerli vektörde skor BİREBİR aynı.
 *
 * Güvence altına alınanlar:
 *  - parseDiscVector: geçerli → aynı beş alan; eksik anahtar / NaN / Infinity / metin / null /
 *    dizi / confidence'sız → null, istisna yok.
 *  - rankMentisForMentor + rankMentorsForMenti: bozuk vektör → vektörsüz (null) ile AYNI sonuç,
 *    tüm skorlar sonlu sayı.
 *  - geçerli vektör: skorlar AJ-94 öncesi koddan alınmış sabit değerlerle birebir (regresyon).
 *  - analyticsController (üçüncü çağrı noktası): bozuk vektör → discType yedeği (vektörsüz yol).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown> & { id: string };
let pool: Row[] = [];
let profileVector: unknown = null;

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      // Hem mentör (rankMentisForMentor) hem menti (rankMentorsForMenti) kendi profilini buradan okur.
      findFirst: vi.fn(async (args: { where: { id: string } }) => ({
        id: args.where.id,
        tenantId: 't1',
        sectorTags: ['teknoloji'],
        discType: 'C',
        discVector: profileVector,
        timeCommitment: null,
        interactionStyle: null,
        expectationCategories: [],
      })),
      findMany: vi.fn(async (args: { where: { id: { gt?: string } } }) =>
        args.where.id.gt ? [] : [...pool].sort((a, b) => (a.id < b.id ? -1 : 1)),
      ),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ minMatchScoreThreshold: 0, blockedPairs: [] }),
      findMany: vi.fn().mockResolvedValue([]),
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

vi.mock('../src/services/profile-completeness.service.js', () => ({
  computeProfileCompleteness: vi.fn().mockResolvedValue({ coreComplete: true }),
}));

import { parseDiscVector } from '../src/services/scoring.js';
import { rankMentisForMentor, rankMentorsForMenti } from '../src/services/matching.js';
import { getAnalytics } from '../src/controllers/analyticsController.js';
import type { RequestWithTenant } from '../src/types.js';
import type { Response } from 'express';

const VALID = { D: 0.4, I: 0.3, S: 0.2, C: 0.1, confidence: 0.8 };

// Bozuk kayıt örnekleri — hepsi vektörsüz yola düşmeli.
const BROKEN: Array<[string, unknown]> = [
  ['eksik anahtar (C yok)', { D: 0.4, I: 0.3, S: 0.3, confidence: 0.8 }],
  ['NaN', { D: Number.NaN, I: 0.3, S: 0.2, C: 0.1, confidence: 0.8 }],
  ['Infinity', { D: Number.POSITIVE_INFINITY, I: 0.3, S: 0.2, C: 0.1, confidence: 0.8 }],
  ['metin değer', { D: 'x', I: 0.3, S: 0.2, C: 0.1, confidence: 0.8 }],
  ['sayı-benzeri metin', { D: '0.4', I: '0.3', S: '0.2', C: '0.1', confidence: 0.8 }],
  ['confidence yok (PS-02 öncesi kayıt)', { D: 0.4, I: 0.3, S: 0.2, C: 0.1 }],
  ['düz metin JSON', 'bozuk'],
  ['dizi', [0.4, 0.3, 0.2, 0.1, 0.8]],
];

function person(id: string, discType: string, sectorTags: string[], discVector: unknown): Row {
  return {
    id,
    fullName: `Kişi ${id}`,
    tenantId: 't1',
    sectorTags,
    discType,
    discVector,
    skills: [],
    avatarUrl: null,
    timeCommitment: null,
    interactionStyle: null,
    expectationCategories: [],
    mentorVisibilityEnabled: true,
    memberships: [],
  };
}

function scoresOf(items: Array<{ totalScore: number; discScore: number; confidence: number }>) {
  return items.map((i) => ({ totalScore: i.totalScore, discScore: i.discScore, confidence: i.confidence }));
}

describe('AJ-94 · parseDiscVector (saf)', () => {
  it('geçerli vektör → aynı beş alan (fazla anahtar düşer)', () => {
    expect(parseDiscVector({ ...VALID, extra: 'x' })).toEqual(VALID);
  });

  it('confidence 0 geçerlidir (vektörsüz yola karar computeDiscScore\'un işi)', () => {
    expect(parseDiscVector({ ...VALID, confidence: 0 })).toEqual({ ...VALID, confidence: 0 });
  });

  it.each([...BROKEN, ['null', null], ['undefined', undefined]] as Array<[string, unknown]>)(
    'bozuk: %s → null, istisna yok',
    (_label, raw) => {
      expect(() => parseDiscVector(raw)).not.toThrow();
      expect(parseDiscVector(raw)).toBeNull();
    },
  );
});

describe('AJ-94 · rankMentisForMentor — aday mentinin bozuk vektörü', () => {
  beforeEach(() => {
    profileVector = null;
  });

  it.each(BROKEN)('%s → vektörsüz aday ile aynı skor, sonlu sayı', async (_label, broken) => {
    pool = [person('m-null', 'S', ['teknoloji'], null)];
    const baseline = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });

    pool = [person('m-null', 'S', ['teknoloji'], broken)];
    const { items } = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });

    expect(items).toHaveLength(1);
    expect(scoresOf(items)).toEqual(scoresOf(baseline.items));
    for (const i of items) {
      expect(Number.isFinite(i.totalScore)).toBe(true);
      expect(Number.isFinite(i.discScore)).toBe(true);
    }
  });

  it('geçerli vektör → AJ-94 öncesi skorla birebir (regresyon)', async () => {
    // Mentör discType C (findFirst). Sabitler AJ-94 öncesi koddan (as DiscVector) ölçüldü.
    pool = [
      person('a', 'D', ['teknoloji'], VALID),
      person('b', 'S', ['saglik'], { D: 0.1, I: 0.1, S: 0.7, C: 0.1, confidence: 0.3 }),
    ];
    const { items } = await rankMentisForMentor({ mentorId: 'mentor', mentorTenantId: 't1' });
    expect(items.map((i) => [i.mentiId, i.totalScore, i.discScore, i.confidence])).toEqual([
      ['a', 91, 77.4, 0.8],
      ['b', 26.3, 65.8, 0.3],
    ]);
  });
});

describe('AJ-94 · rankMentorsForMenti — mentinin kendi bozuk vektörü', () => {
  beforeEach(() => {
    pool = [
      person('x', 'D', ['teknoloji'], null),
      person('y', 'I', ['saglik'], null),
    ];
  });

  it.each(BROKEN)('%s → vektörsüz menti ile aynı sıra ve skor, sonlu sayı', async (_label, broken) => {
    profileVector = null;
    const baseline = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1' });

    profileVector = broken;
    const { items } = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1' });

    expect(items.map((i) => i.mentorId)).toEqual(baseline.items.map((i) => i.mentorId));
    expect(scoresOf(items)).toEqual(scoresOf(baseline.items));
    for (const i of items) {
      expect(Number.isFinite(i.totalScore)).toBe(true);
      expect(Number.isFinite(i.discScore)).toBe(true);
    }
  });

  it('geçerli vektör → AJ-94 öncesi skorla birebir (regresyon)', async () => {
    // Menti discType C + VALID vektör. Sabitler AJ-94 öncesi koddan (as DiscVector) ölçüldü.
    profileVector = VALID;
    const { items } = await rankMentorsForMenti({ mentiId: 'menti', mentiTenantId: 't1' });
    expect(items.map((i) => [i.mentorId, i.totalScore, i.discScore, i.confidence])).toEqual([
      ['x', 86.3, 65.8, 0.8],
      ['y', 28.2, 70.4, 0.8],
    ]);
  });
});

describe('AJ-94 · getAnalytics — üçüncü çağrı noktası', () => {
  async function analyticsFor(vector: unknown) {
    profileVector = vector;
    const res = { statusCode: 200, body: undefined as unknown } as {
      statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res;
    };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    const req = { params: { userId: 'u-1' }, tenant: { tenantId: 't1' } } as unknown as RequestWithTenant;
    await getAnalytics(req, res as unknown as Response);
    return res as { statusCode: number; body: { discVector: Record<string, number> } };
  }

  it('geçerli vektör → olduğu gibi kullanılır', async () => {
    const res = await analyticsFor(VALID);
    expect(res.statusCode).toBe(200);
    expect(res.body.discVector).toEqual(VALID);
  });

  it.each(BROKEN)('%s → vektörsüz yol: discType (C) yedeği, sonlu değerler', async (_label, broken) => {
    const res = await analyticsFor(broken);
    expect(res.statusCode).toBe(200);
    // discType yedeği: baskın boyut 0.7, diğerleri 0.1, confidence 0.3 (analyticsController).
    expect(res.body.discVector).toEqual({ D: 0.1, I: 0.1, S: 0.1, C: 0.7, confidence: 0.3 });
  });
});
