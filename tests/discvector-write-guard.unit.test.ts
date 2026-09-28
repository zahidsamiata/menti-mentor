/**
 * AJ-95a (madde 170) — `recalcDiscVector` eşleştirmenin okuduğu `discVector`'u yazmadan ÖNCE
 * doğrular (DB'siz, prisma sahte).
 *
 * Senaryo: DB'de aralık dışı bir Likert değeri (bozuk kayıt, ör. elle düzeltme/eski betik) negatif
 * boyut ortalaması → negatif vektör bileşeni üretir. Eskiden bu vektör olduğu gibi yazılıyor ve
 * eşleştirme skorunu sessizce bozuyordu. Ölçüt: bozuk vektör → fırlatır, `user.update` ve
 * `userProfile.upsert` ÇAĞRILMAZ; geçerli yanıtlarda davranış aynı (yazım yapılır).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const userUpdate = vi.fn().mockResolvedValue({});
const profileUpsert = vi.fn().mockResolvedValue({});

vi.mock('../src/db.js', () => ({
  prisma: {
    question: { count: vi.fn().mockResolvedValue(4) },
    userResponse: { findMany: (...a: unknown[]) => findMany(...a) },
    user: { update: (...a: unknown[]) => userUpdate(...a) },
    userProfile: { upsert: (...a: unknown[]) => profileUpsert(...a) },
  },
}));

import { recalcDiscVector, invalidateDimensionalCountCache } from '../src/services/discVectorService.js';
import { JsonFieldValidationError } from '../src/services/jsonFieldSchemas.js';

function response(dim: 'D' | 'I' | 'S' | 'C', value: number) {
  return { value, question: { discDimension: dim, isActive: true } };
}

beforeEach(() => {
  invalidateDimensionalCountCache();
  findMany.mockReset();
  userUpdate.mockClear();
  profileUpsert.mockClear();
});

describe('AJ-95a · recalcDiscVector yazım kapısı', () => {
  it('bozuk kayıt (aralık dışı Likert → negatif bileşen) → fırlatır, hiçbir yazım yapılmaz', async () => {
    findMany.mockResolvedValue([response('D', -20), response('I', 5), response('S', 5), response('C', 5)]);
    await expect(recalcDiscVector('u-1', 't-1')).rejects.toBeInstanceOf(JsonFieldValidationError);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(profileUpsert).not.toHaveBeenCalled();
  });

  it('geçerli yanıtlar → vektör doğrulanıp yazılır (davranış aynı)', async () => {
    findMany.mockResolvedValue([response('D', 5), response('I', 3), response('S', 1), response('C', 3)]);
    const vector = await recalcDiscVector('u-1', 't-1');
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate.mock.calls[0]![0]).toEqual({ where: { id: 'u-1' }, data: { discVector: vector } });
    expect(vector.confidence).toBe(1);
    expect(profileUpsert).toHaveBeenCalledTimes(1);
  });
});
