/**
 * Scoring Birim Testleri — DB bağlantısı gerektirmez.
 *
 * Bu dosya globalSetup/DB bağlantısı olmadan tek başına çalışabilir:
 *   npx vitest run tests/scoring.unit.test.ts --reporter=verbose
 *
 * Kapsam: computeSectorScore Jaccard tabanlı değişken skor üretimi (P1 regresyon).
 */

import { describe, it, expect } from 'vitest';
import { computeSectorScore } from '../src/services/scoring.js';

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
