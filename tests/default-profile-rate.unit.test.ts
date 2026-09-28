/**
 * AJ-79 (md.111 / G2-06) — "varsayılana düşen profil" oranı BİRİM testleri (DB bağımsız).
 *
 * Tek başına çalışabilir:
 *   npx vitest run tests/default-profile-rate.unit.test.ts --reporter=verbose
 *
 * `maskDefaultProfileRate` platform kurum analizinde DISC vektörü olmayan aktif üye oranını
 * hesaplar ve k-anonimlik eşiğinin altındaki kurumda sayıyı/oranı gizler.
 */

import { describe, it, expect } from 'vitest';
import { K_ANONYMITY_THRESHOLD, maskDefaultProfileRate } from '../src/services/mask.js';

describe('maskDefaultProfileRate', () => {
  it('5 üyeden 2 vektörsüz → %40', () => {
    expect(maskDefaultProfileRate(2, 5)).toEqual({
      withoutVector: 2,
      activeMembers: 5,
      ratePercent: 40,
      suppressed: false,
      minGroupSize: K_ANONYMITY_THRESHOLD,
    });
  });

  it('oran tek ondalığa yuvarlanır (1/3 → 33,3)', () => {
    expect(maskDefaultProfileRate(1, 3).ratePercent).toBe(33.3);
  });

  it('eşik üyede görünür (tam sınır)', () => {
    const r = maskDefaultProfileRate(3, K_ANONYMITY_THRESHOLD);
    expect(r.suppressed).toBe(false);
    expect(r.ratePercent).toBe(100);
  });

  it('negatif: eşiğin altındaki kurumda gerçek sayı ve oran sızmaz', () => {
    for (let members = 1; members < K_ANONYMITY_THRESHOLD; members++) {
      expect(maskDefaultProfileRate(1, members)).toEqual({
        withoutVector: 0,
        activeMembers: 0,
        ratePercent: null,
        suppressed: true,
        minGroupSize: K_ANONYMITY_THRESHOLD,
      });
    }
  });

  it('hiç üye yoksa gizli değil, oran yok', () => {
    expect(maskDefaultProfileRate(0, 0)).toEqual({
      withoutVector: 0,
      activeMembers: 0,
      ratePercent: null,
      suppressed: false,
      minGroupSize: K_ANONYMITY_THRESHOLD,
    });
  });
});
