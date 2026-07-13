/**
 * Scoring Birim Testleri — DB bağlantısı gerektirmez.
 *
 * Bu dosya globalSetup/DB bağlantısı olmadan tek başına çalışabilir:
 *   npx vitest run tests/scoring.unit.test.ts --reporter=verbose
 *
 * Kapsam: computeSectorScore Jaccard tabanlı değişken skor üretimi (P1 regresyon).
 */

import { describe, it, expect } from 'vitest';
import { computeSectorScore, applyQualityMultiplier } from '../src/services/scoring.js';

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
