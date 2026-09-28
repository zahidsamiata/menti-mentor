/**
 * AJ-108 — eski soru-başına DISC yolunda (`recalcDiscVector`) dört boyutun toplamı 0 iken vektör
 * (DB'siz, prisma sahte; yazım doğrulaması gerçek).
 *
 * Neden: tüm cevaplar Likert 1 ise her boyut ortalaması 0, toplam 0 → bölme NaN üretiyordu;
 * yazım doğrulaması (DiscVectorWriteSchema) NaN'ı reddettiği için kullanıcı aynı cevapla ilerleyemezdi.
 * Ölçüt: toplam 0 → eşit dağılım (0.25 × 4, uyarlanabilir motorla aynı), yazım yapılır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type ResponseRow = { value: number; question: { discDimension: string; isActive: boolean } };

const responseFindMany = vi.fn(async (): Promise<ResponseRow[]> => []);
const questionCount = vi.fn(async () => 4);
const userUpdate = vi.fn(async (_args: unknown) => ({}));
const profileUpsert = vi.fn(async (_args: unknown) => ({}));

vi.mock('../src/db.js', () => ({
  prisma: {
    userResponse: { findMany: () => responseFindMany() },
    question: { count: () => questionCount() },
    user: { update: (args: unknown) => userUpdate(args) },
    userProfile: { upsert: (args: unknown) => profileUpsert(args) },
  },
}));

import { recalcDiscVector } from '../src/services/discVectorService.js';

function answer(dim: string, value: number): ResponseRow {
  return { value, question: { discDimension: dim, isActive: true } };
}

beforeEach(() => {
  userUpdate.mockClear();
  profileUpsert.mockClear();
});

describe('AJ-108 · recalcDiscVector — dört boyut toplamı 0', () => {
  it('tüm cevaplar Likert 1 → geçerli eşit dağılım vektörü, yazım yapılır', async () => {
    responseFindMany.mockResolvedValueOnce(['D', 'I', 'S', 'C'].map((d) => answer(d, 1)));

    const vector = await recalcDiscVector('u-sifir-toplam', 't-1');

    expect(vector).toEqual({ D: 0.25, I: 0.25, S: 0.25, C: 0.25, confidence: 1 });
    for (const k of ['D', 'I', 'S', 'C'] as const) expect(Number.isFinite(vector[k])).toBe(true);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(profileUpsert).toHaveBeenCalledTimes(1);
  });

  it('toplam 0 değilken normalize davranışı aynı (D=5, diğerleri 1 → D=1)', async () => {
    responseFindMany.mockResolvedValueOnce([answer('D', 5), answer('I', 1), answer('S', 1), answer('C', 1)]);

    const vector = await recalcDiscVector('u-normal', 't-2');

    expect(vector).toMatchObject({ D: 1, I: 0, S: 0, C: 0 });
  });
});
