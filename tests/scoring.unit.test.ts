/**
 * Scoring Birim Testleri — DB bağlantısı gerektirmez.
 *
 * Bu dosya globalSetup/DB bağlantısı olmadan tek başına çalışabilir:
 *   npx vitest run tests/scoring.unit.test.ts --reporter=verbose
 *
 * Kapsam: computeSectorScore Jaccard tabanlı değişken skor üretimi (P1 regresyon).
 */

import { describe, it, expect } from 'vitest';
import { computeSectorScore, applyQualityMultiplier, computeTotalScore } from '../src/services/scoring.js';

describe('computeSectorScore: sabit 50 değil, Jaccard tabanlı değişken skor', () => {
  it('tam eşleşme 100 döner', () => {
    expect(computeSectorScore(['teknoloji'], ['teknoloji'])).toBe(100);
  });

  it('kısmi eşleşme doğru yüzde döner', () => {
    // mentiTags 2 etiket, 1 eşleşme → 1/2 = %50
    expect(computeSectorScore(['teknoloji', 'sanat'], ['teknoloji', 'finans'])).toBe(50);
  });

  it('sıfır eşleşme 0 döner', () => {
    expect(computeSectorScore(['sağlık'], ['teknoloji'])).toBe(0);
  });

  it('boş mentiTags 0 döner (erken dönüş guard)', () => {
    expect(computeSectorScore([], ['teknoloji'])).toBe(0);
  });

  it('boş mentorTags 0 döner (eşleşme bulunamaz)', () => {
    expect(computeSectorScore(['teknoloji'], [])).toBe(0);
  });

  it('üç farklı girdi üç farklı sonuç verir — sabit değer değil', () => {
    const s1 = computeSectorScore(['teknoloji'], ['teknoloji']);           // 100 (1/1)
    const s2 = computeSectorScore(['teknoloji', 'sanat'], ['teknoloji']); // 50  (1/2)
    const s3 = computeSectorScore(['sağlık'], ['teknoloji']);              // 0   (0/1)
    expect(new Set([s1, s2, s3]).size).toBe(3);
  });
});

describe('applyQualityMultiplier: feedback döngüsü katsayısı', () => {
  it('3 görüşmeden az veri → nötr katsayı (1.0)', () => {
    expect(applyQualityMultiplier(3.0, 2)).toBe(1.0);
    expect(applyQualityMultiplier(1.0, 0)).toBe(1.0);
  });

  it('mükemmel puan (5.0, ≥3 görüşme) → maksimum artış (1.2)', () => {
    expect(applyQualityMultiplier(5.0, 3)).toBe(1.2);
    expect(applyQualityMultiplier(5.0, 10)).toBe(1.2);
  });

  it('çok kötü puan (1.0, ≥3 görüşme) → maksimum düşüş (0.8)', () => {
    expect(applyQualityMultiplier(1.0, 3)).toBe(0.8);
  });

  it('nötr puan (3.0, ≥3 görüşme) → katsayı değişmez (1.0)', () => {
    expect(applyQualityMultiplier(3.0, 5)).toBe(1.0);
  });

  it('iyi puan (4.0) → hafif artış (%10)', () => {
    // (4.0 - 3.0) / 2.0 * 0.2 = 0.1 → 1.1
    expect(applyQualityMultiplier(4.0, 5)).toBe(1.1);
  });

  it('kötü puan (2.0) → hafif düşüş (%10)', () => {
    // (2.0 - 3.0) / 2.0 * 0.2 = -0.1 → 0.9
    expect(applyQualityMultiplier(2.0, 5)).toBe(0.9);
  });

  it('sınır değerler: katsayı 0.8 ile 1.2 arasında kalır', () => {
    expect(applyQualityMultiplier(0.1, 10)).toBeGreaterThanOrEqual(0.8);
    expect(applyQualityMultiplier(9.9, 10)).toBeLessThanOrEqual(1.2);
  });
});

// ─── computeTotalScore: tenant-özel ağırlık (madde 87 — 9b) ───────────────────
//
// Sabit girdi: sektör tam eşleşir (sectorScore=100), DISC C→C matris uyumu = 60 (discScore=60).
// Böylece iki bileşen FARKLI olur → ağırlık değişimi total'i ölçülebilir biçimde kaydırır.
const BASE_ARGS = {
  mentiTags: ['teknoloji'],
  mentorTags: ['teknoloji'],
  mentiDisc: 'C' as const,
  mentorDisc: 'C' as const,
};

describe('computeTotalScore: ağırlık parametreleri', () => {
  it('⭐ REGRESYON: ağırlık verilmezse eski 0.6/0.4 davranışı BİREBİR korunur', () => {
    const r = computeTotalScore(BASE_ARGS);
    // sectorScore=100, discScore=60 → 100*0.6 + 60*0.4 = 60 + 24 = 84
    expect(r.sectorScore).toBe(100);
    expect(r.discScore).toBe(60);
    expect(r.totalScore).toBe(84);
  });

  it('⭐ REGRESYON: açıkça 0.6/0.4 vermek, varsayılanla AYNI skoru üretir', () => {
    const withoutWeights = computeTotalScore(BASE_ARGS);
    const withDefaults = computeTotalScore({ ...BASE_ARGS, sectorWeight: 0.6, discWeight: 0.4 });
    expect(withDefaults.totalScore).toBe(withoutWeights.totalScore);
  });

  it('kayıtlı ağırlık VARSA motor onu kullanır — farklı ağırlık → farklı skor', () => {
    const base = computeTotalScore(BASE_ARGS).totalScore; // 84 (0.6/0.4)
    // DISC'e daha çok güven: 0.4/0.6 → 100*0.4 + 60*0.6 = 40 + 36 = 76
    const discHeavy = computeTotalScore({ ...BASE_ARGS, sectorWeight: 0.4, discWeight: 0.6 });
    expect(discHeavy.totalScore).toBe(76);
    expect(discHeavy.totalScore).not.toBe(base);
  });

  it('sektör ağırlığı artınca (yüksek sektör skorunda) total artar', () => {
    // sectorScore(100) > discScore(60): sektör ağırlığı arttıkça total ↑
    const s70 = computeTotalScore({ ...BASE_ARGS, sectorWeight: 0.7, discWeight: 0.3 }).totalScore; // 88
    const s40 = computeTotalScore({ ...BASE_ARGS, sectorWeight: 0.4, discWeight: 0.6 }).totalScore; // 76
    expect(s70).toBeGreaterThan(s40);
  });

  it('ağırlık + qualityMultiplier birlikte doğru uygulanır', () => {
    // base 84 (0.6/0.4) × 1.1 = 92.4
    const r = computeTotalScore({ ...BASE_ARGS, qualityMultiplier: 1.1 });
    expect(r.totalScore).toBeCloseTo(92.4, 5);
  });
});
