/**
 * Scoring algoritması matematiksel doğrulama vakası.
 * Bu dosyayı `npx tsx src/services/scoring.test-cases.ts` ile çalıştırın.
 *
 * Formüller:
 *   sectorScore = kesişim / mentiTagSayısı × 100   (0-100)
 *   discScore   = DISC_COMPATIBILITY[mentorDisc][mentiDisc]  (0-100)
 *   totalScore  = sectorScore × 0.60 + discScore × 0.40     (0-100)
 *
 * Vektör bazlı DISC:
 *   vectorScore  = Σ(mentiVector[dim] × DISC_COMPATIBILITY[mentorDisc][dim])
 *   blendedDisc  = confidence × vectorScore + (1-confidence) × matrixScore
 */

import {
  computeSectorScore,
  computeDiscScore,
  computeTotalScore,
  isAntiMatch,
} from './scoring.js';

let passed = 0;
let failed = 0;

function assert(label: string, actual: number, expected: number, tolerance = 0.1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: beklenen ${expected}, gerçek ${actual}`);
    failed++;
  }
}

function assertBool(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`  ✓ ${label}: ${actual}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}: beklenen ${expected}, gerçek ${actual}`);
    failed++;
  }
}

console.log('\n=== SEKTÖR SKORU TESTLERİ ===');

// Tam örtüşme: her tag mentor'da da var
assert('Tam örtüşme (3/3)', computeSectorScore(['tech', 'finance', 'ai'], ['tech', 'finance', 'ai']), 100);

// Kısmi örtüşme: 2/3 etiket örtüşüyor
assert('Kısmi örtüşme (2/3)', computeSectorScore(['tech', 'finance', 'ai'], ['tech', 'finance', 'law']), 66.7);

// Sıfır örtüşme
assert('Sıfır örtüşme', computeSectorScore(['tech'], ['finance']), 0);

// Menti etiketi yok → 0 (eşleşme ölçülemez)
assert('Menti etiketi yok', computeSectorScore([], ['tech']), 0);

// Mentor etiketi yok → örtüşme yok → 0
assert('Mentor etiketi yok', computeSectorScore(['tech'], []), 0);

// Büyük-küçük harf duyarsızlık
assert('Büyük-küçük harf', computeSectorScore(['Tech'], ['tech']), 100);

console.log('\n=== DISC SKORU TESTLERİ ===');

// Matris okuması: D mentor, C menti → 85
assert('D→C matris skoru', computeDiscScore('C', 'D'), 85);

// Matris okuması: D mentor, S menti → 30
assert('D→S matris skoru', computeDiscScore('S', 'D'), 30);

// Mentor yok → 50 (nötr)
assert('Mentor DISC yok', computeDiscScore(null, null), 50);

// Vektör bazlı: confidence=1, menti vektörü={D:1,I:0,S:0,C:0}, mentor=D
// vectorScore = 1*60 + 0*75 + 0*30 + 0*85 = 60
// matrixScore = 50 (mentiDisc=null)
// blended = 1*60 + 0*50 = 60
assert('Vektör conf=1, D vektörü, D mentor',
  computeDiscScore(null, 'D', { D: 1, I: 0, S: 0, C: 0, confidence: 1 }), 60);

// Vektör bazlı: confidence=0.5, menti={C:1}, mentor=D
// vectorScore = 0*60 + 0*75 + 0*30 + 1*85 = 85
// matrixScore = 50 (mentiDisc=null)
// blended = 0.5*85 + 0.5*50 = 67.5
assert('Vektör conf=0.5, C vektörü, D mentor',
  computeDiscScore(null, 'D', { D: 0, I: 0, S: 0, C: 1, confidence: 0.5 }), 67.5);

console.log('\n=== TOPLAM SKOR TESTLERİ ===');

// Formül: totalScore = sector*0.6 + disc*0.4
// sector=100, disc=85 → 100*0.6 + 85*0.4 = 60+34 = 94
const t1 = computeTotalScore({
  mentiTags: ['tech'],
  mentorTags: ['tech'],
  mentiDisc: 'C',
  mentorDisc: 'D',
});
assert('Mükemmel sektör + yüksek DISC (94)', t1.totalScore, 94);

// sector=0, disc=50 → 0*0.6 + 50*0.4 = 0+20 = 20
const t2 = computeTotalScore({
  mentiTags: ['finance'],
  mentorTags: ['tech'],
  mentiDisc: undefined,
  mentorDisc: undefined,
});
assert('Sıfır sektör + nötr DISC (20)', t2.totalScore, 20);

// sector=66.7, disc=30 (D→S) → 66.7*0.6 + 30*0.4 = 40.02+12 = 52
const t3 = computeTotalScore({
  mentiTags: ['tech', 'finance', 'ai'],
  mentorTags: ['tech', 'finance', 'law'],
  mentiDisc: 'S',
  mentorDisc: 'D',
});
assert('Kısmi sektör + düşük DISC (~52)', t3.totalScore, 52, 1);

console.log('\n=== ANTI-MATCH TESTLERİ ===');

// D mentor + S menti → anti-match
assertBool('D mentor S menti → anti-match', isAntiMatch('D', 'S'), true);

// D mentor + C menti → normal
assertBool('D mentor C menti → normal', isAntiMatch('D', 'C'), false);

// Eksik DISC → no anti-match
assertBool('Null DISC → no anti-match', isAntiMatch(null, 'S'), false);

console.log(`\n=== SONUÇ: ${passed} geçti / ${failed} başarısız ===\n`);
if (failed > 0) process.exit(1);
