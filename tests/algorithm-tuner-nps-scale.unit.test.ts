/**
 * KR-07 — Ağırlık ayarlayıcının NPS ölçeği BİRİM testleri (DB bağımsız).
 *
 * FeedbackLog.npsScore 0-10'dur (feedbackLogController şeması). İlk sürüm ortalamayı 70/50/60
 * (0-100) eşikleriyle kıyaslıyordu → her ortalama "< 50" sayılıp DISC ağırlığı hep artıyordu.
 * Bu testler eşiklerin 0-10 ölçeğinde çalıştığını ve eski hatanın geri gelmediğini kanıtlar.
 *
 *   npx vitest run tests/algorithm-tuner-nps-scale.unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import { decideSectorWeight, NPS_THRESHOLDS } from '../src/services/algorithmTuner.js';

const base = { phase1AvgNps: null, phase3SampleSize: 10, currentSectorWeight: 0.6 };

describe('NPS_THRESHOLDS: 0-10 ölçeği', () => {
  it('eşikler 0-10 aralığında ve eski 70/50/60 niyetini oranla korur', () => {
    expect(NPS_THRESHOLDS).toEqual({ HIGH: 7, LOW: 5, PHASE3_DROP: 6 });
    for (const v of Object.values(NPS_THRESHOLDS)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

describe('decideSectorWeight: 0-10 ortalama NPS ile eşik davranışı', () => {
  it('ortalama 8 → iyi: ağırlık korunur', () => {
    const r = decideSectorWeight({ ...base, phase3AvgNps: 8 });
    expect(r?.newSectorWeight).toBe(0.6);
    expect(r?.reason).toContain('strateji başarılı');
  });

  it('ortalama tam 7 → iyi (eşik dahil)', () => {
    expect(decideSectorWeight({ ...base, phase3AvgNps: 7 })?.newSectorWeight).toBe(0.6);
  });

  it('ortalama 4 → kötü: DISC ağırlığı +5 (sektör 0.60 → 0.55)', () => {
    const r = decideSectorWeight({ ...base, phase3AvgNps: 4 });
    expect(r?.newSectorWeight).toBeCloseTo(0.55);
    expect(r?.reason).toContain('DISC');
  });

  it('ortalama 6 → orta: sektör ağırlığı +5 (0.60 → 0.65)', () => {
    expect(decideSectorWeight({ ...base, phase3AvgNps: 6 })?.newSectorWeight).toBeCloseTo(0.65);
  });

  it('1. ay 8 → 3. ay 5.5 düşüşü: DISC ağırlığı +5', () => {
    const r = decideSectorWeight({ ...base, phase1AvgNps: 8, phase3AvgNps: 5.5 });
    expect(r?.newSectorWeight).toBeCloseTo(0.55);
    expect(r?.reason).toContain('düşüşü');
  });

  it('ondalık ortalama 6.5 yüksek SAYILMAZ (eski 0-100 eşdeğeri 65 < 70)', () => {
    expect(decideSectorWeight({ ...base, phase3AvgNps: 6.5 })?.newSectorWeight).toBeCloseTo(0.65);
  });

  it('ortalama 0 (herkes 0 verdi) veri yok sayılmaz → DISC ağırlığı artar', () => {
    expect(decideSectorWeight({ ...base, phase3AvgNps: 0 })?.newSectorWeight).toBeCloseTo(0.55);
  });

  it('10 yanıttan az ya da veri yoksa karar yok (null)', () => {
    expect(decideSectorWeight({ ...base, phase3AvgNps: 8, phase3SampleSize: 9 })).toBeNull();
    expect(decideSectorWeight({ ...base, phase3AvgNps: null })).toBeNull();
  });

  it('MIN/MAX sınırları korunur', () => {
    expect(decideSectorWeight({ ...base, phase3AvgNps: 2, currentSectorWeight: 0.4 })?.newSectorWeight).toBe(0.4);
    expect(decideSectorWeight({ ...base, phase3AvgNps: 6, currentSectorWeight: 0.7 })?.newSectorWeight).toBe(0.7);
  });
});

describe('Negatif: eski hatalı davranış (her şeyin "düşük" sayılması) geri gelmedi', () => {
  it('0-10 aralığındaki en yüksek ortalamalar (9, 10) DISC artışına düşmez', () => {
    for (const avg of [9, 10]) {
      const r = decideSectorWeight({ ...base, phase3AvgNps: avg });
      expect(r?.newSectorWeight).toBe(0.6);
      expect(r?.reason).not.toContain('DISC');
    }
  });

  it('5 ile 7 arası ortalamalar "düşük" dalına düşmez (eski kodda hepsi < 50 idi)', () => {
    for (const avg of [5, 5.5, 6, 6.9]) {
      expect(decideSectorWeight({ ...base, phase3AvgNps: avg })?.newSectorWeight).toBeCloseTo(0.65);
    }
  });
});
