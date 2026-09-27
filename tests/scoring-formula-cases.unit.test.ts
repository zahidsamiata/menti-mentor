/**
 * PS-09 — `src/services/scoring.test-cases.ts` elle hesaplanmış formül vakaları, `npm test`/CI kapsamına alındı.
 * ⚠️ Beklenen değerler ve toleranslar kaynak betikten BİREBİR kopyalandı; değiştirilirse formül sessizce kayar.
 * Kaynak betik (`npm run test:scoring`) yerinde duruyor — bu dosya onun CI'daki karşılığı.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDiscScore,
  computeSectorScore,
  computeTotalScore,
  isAntiMatch,
} from '../src/services/scoring.js';

function expectClose(actual: number, expected: number, tolerance = 0.1): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe('PS-09 · sektör skoru', () => {
  it('Tam örtüşme (3/3)', () => expectClose(computeSectorScore(['tech', 'finance', 'ai'], ['tech', 'finance', 'ai']), 100));
  it('Kısmi örtüşme (2/3)', () => expectClose(computeSectorScore(['tech', 'finance', 'ai'], ['tech', 'finance', 'law']), 66.7));
  it('Sıfır örtüşme', () => expectClose(computeSectorScore(['tech'], ['finance']), 0));
  it('Menti etiketi yok', () => expectClose(computeSectorScore([], ['tech']), 0));
  it('Mentor etiketi yok', () => expectClose(computeSectorScore(['tech'], []), 0));
  it('Büyük-küçük harf', () => expectClose(computeSectorScore(['Tech'], ['tech']), 100));
});

describe('PS-09 · DISC skoru', () => {
  it('D→C matris skoru', () => expectClose(computeDiscScore('C', 'D'), 85));
  it('D→S matris skoru', () => expectClose(computeDiscScore('S', 'D'), 30));
  it('Mentor DISC yok', () => expectClose(computeDiscScore(null, null), 50));
  // vectorScore = 1*60 + 0*75 + 0*30 + 0*85 = 60 · matrixScore = 50 · blended = 1*60 + 0*50 = 60
  it('Vektör conf=1, D vektörü, D mentor', () =>
    expectClose(computeDiscScore(null, 'D', { D: 1, I: 0, S: 0, C: 0, confidence: 1 }), 60));
  // vectorScore = 85 · matrixScore = 50 · blended = 0.5*85 + 0.5*50 = 67.5
  it('Vektör conf=0.5, C vektörü, D mentor', () =>
    expectClose(computeDiscScore(null, 'D', { D: 0, I: 0, S: 0, C: 1, confidence: 0.5 }), 67.5));
});

describe('PS-09 · toplam skor (sector*0.6 + disc*0.4)', () => {
  it('Mükemmel sektör + yüksek DISC (94)', () => {
    const result = computeTotalScore({ mentiTags: ['tech'], mentorTags: ['tech'], mentiDisc: 'C', mentorDisc: 'D' });
    expectClose(result.totalScore, 94);
  });
  it('Sıfır sektör + nötr DISC (20)', () => {
    const result = computeTotalScore({ mentiTags: ['finance'], mentorTags: ['tech'], mentiDisc: undefined, mentorDisc: undefined });
    expectClose(result.totalScore, 20);
  });
  it('Kısmi sektör + düşük DISC (~52)', () => {
    const result = computeTotalScore({
      mentiTags: ['tech', 'finance', 'ai'],
      mentorTags: ['tech', 'finance', 'law'],
      mentiDisc: 'S',
      mentorDisc: 'D',
    });
    expectClose(result.totalScore, 52, 1);
  });
});

describe('PS-09 · anti-match', () => {
  it('D mentor S menti → anti-match', () => expect(isAntiMatch('D', 'S')).toBe(true));
  it('D mentor C menti → normal', () => expect(isAntiMatch('D', 'C')).toBe(false));
  it('Null DISC → no anti-match', () => expect(isAntiMatch(null, 'S')).toBe(false));
});
