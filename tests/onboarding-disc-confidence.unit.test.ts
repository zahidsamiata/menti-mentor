/**
 * PS-02 — onboarding DISC vektörüne yazılan confidence regresyon testi (saf mantık, DB gerektirmez).
 *
 * Hata zinciri: onboardingController.submitDiscTest, confidence alanı OLMADAN bir DISC vektörü
 * (`{D,I,S,C}`) yazıyordu. scoring.ts/discVectorService.ts vektörü değerlendirirken
 * `vector.confidence > 0` kontrolü yapıyor — `undefined > 0` daima `false` olduğundan vektör
 * "yok" sayılıyor, kullanıcının onboarding cevapları eşleştirmede sessizce atlanıyordu; buna
 * rağmen computeTotalScore `confidence ?? (mentiDisc ? 1 : 0.5)` fallback'i ile API'ye yanıltıcı
 * şekilde "tam güven" (1) bildiriyordu.
 *
 * Bu test iki şeyi kanıtlar:
 *  (a) calculateDiscResult artık gerçek, sayısal bir confidence üretir (eksik/undefined değil).
 *  (b) scoring.ts'in `computeDiscScore`/`computeTotalScore` fonksiyonları bu confidence sayesinde
 *      vektörü GERÇEKTEN kullanır — confidence eksikken (eski/bozuk kayıt simülasyonu) düştüğü
 *      "vektör yok" dalıyla, confidence varken (düzeltilmiş kayıt) izlediği "vektör kullanılıyor"
 *      dalının FARKLI sonuç ürettiğini doğrudan gösterir.
 */

import { describe, it, expect } from 'vitest';
import { calculateDiscResult } from '../src/controllers/onboardingController.js';
import { computeDiscScore, computeTotalScore, type DiscVector } from '../src/services/scoring.js';

describe('calculateDiscResult — confidence (PS-02)', () => {
  it('8/8 soru cevaplanınca confidence tam (1.0)', () => {
    const answers = Array.from({ length: 8 }, (_, i) => ({
      questionId: i + 1,
      selectedOption: 'A',
    }));
    const result = calculateDiscResult(answers);
    expect(result.confidence).toBe(1);
    expect(typeof result.confidence).toBe('number');
  });

  it('kısmi (6/8) cevapta confidence orantılı ve 1\'in altında', () => {
    const answers = Array.from({ length: 6 }, (_, i) => ({
      questionId: i + 1,
      selectedOption: 'A',
    }));
    const result = calculateDiscResult(answers);
    expect(result.confidence).toBeCloseTo(0.75, 5);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });

  it('confidence hiçbir zaman undefined/NaN dönmez', () => {
    const result = calculateDiscResult([
      { questionId: 1, selectedOption: 'A' },
      { questionId: 2, selectedOption: 'B' },
      { questionId: 3, selectedOption: 'C' },
      { questionId: 4, selectedOption: 'D' },
      { questionId: 5, selectedOption: 'A' },
      { questionId: 6, selectedOption: 'B' },
    ]);
    expect(result.confidence).not.toBeUndefined();
    expect(Number.isNaN(result.confidence)).toBe(false);
  });
});

describe('PS-02 hata zinciri — scoring.ts confidence eksikken vektörü yok sayıyordu', () => {
  it('confidence olmayan (eski/bozuk) vektör → matris skoruna düşer (vektör YOK SAYILIR)', () => {
    // Eski hatalı yazım simülasyonu: confidence alanı hiç yok (`as any` ile tip kenetini atlatıyoruz —
    // gerçek bug de tam olarak buydu: alan DB'de gerçekten yoktu, TypeScript'in göremediği bir JSON alanıydı).
    const brokenVector = { D: 0.7, I: 0.1, S: 0.1, C: 0.1 } as unknown as DiscVector;

    const scoreWithBrokenVector = computeDiscScore('D', 'C', brokenVector);
    const scoreWithoutVectorAtAll = computeDiscScore('D', 'C', null);

    // undefined > 0 → false → computeDiscScore vektörü hiç kullanmadan doğrudan matrise düşer.
    // Bu, vektör TAMAMEN YOKMUŞ gibi davranmasıyla birebir aynı sonucu verir — bug'ın kanıtı.
    expect(scoreWithBrokenVector).toBe(scoreWithoutVectorAtAll);
  });

  it('düzeltilmiş vektör (confidence dahil) → vektör GERÇEKTEN kullanılır, matristen farklı sonuç üretir', () => {
    // KARIŞIK vektör kasıtlı: saf tek-boyutlu vektör (ör. hepsi 'A' → D=1) yanıltıcı biçimde
    // matris hücresiyle AYNI sonucu üretir (computeVectorDiscScore tek terime indirgenir ve
    // dominant tip zaten mentiDisc ile eşleşir) — bu, gerçek blend davranışını KANITLAMAZ.
    // 4×'A' (D) + 4×'D seçeneği' (C) → vector {D:0.5, I:0, S:0, C:0.5}, dominant tiebreak'te 'D'
    // kazanır (D>I>S>C, D ve C eşit sayıda) — matris hücresi DISC_COMPATIBILITY['C']['D'] hâlâ 'D'
    // için hesaplanır ama vektör skoru KARIŞIK olduğundan matris hücresinden gerçekten FARKLIDIR.
    const answers = [
      ...Array.from({ length: 4 }, (_, i) => ({ questionId: i + 1, selectedOption: 'A' })),
      ...Array.from({ length: 4 }, (_, i) => ({ questionId: i + 5, selectedOption: 'D' })),
    ];
    const result = calculateDiscResult(answers);
    expect(result.dominant).toBe('D'); // tiebreak D>I>S>C doğrulaması
    const fixedVector: DiscVector = { ...result.vector, confidence: result.confidence };

    const scoreWithFixedVector = computeDiscScore('D', 'C', fixedVector);
    const scoreFromMatrixOnly = computeDiscScore('D', 'C', null);

    // confidence = 1.0 → computeDiscScore tamamen vektör skorunu kullanır (blend'de (1-confidence)=0);
    // karışık {D:0.5,C:0.5} vektör, matris hücresi DISC_COMPATIBILITY['C']['D']=85'ten
    // matematiksel olarak FARKLI bir ağırlıklı ortalama üretir (0.5*85 + 0.5*60 = 72.5).
    expect(scoreWithFixedVector).not.toBe(scoreFromMatrixOnly);
  });

  it('computeTotalScore: confidence eksik senaryoda fallback yanıltıcı biçimde 1 raporluyordu, düzeltilmiş vektörde gerçek confidence yansır', () => {
    const totalWithBrokenVector = computeTotalScore({
      mentiTags: ['yazilim'],
      mentorTags: ['yazilim'],
      mentiDisc: 'D',
      mentorDisc: 'C',
      mentiVector: { D: 0.7, I: 0.1, S: 0.1, C: 0.1 } as unknown as DiscVector,
    });
    // Bug: confidence alanı yok ama fallback (`confidence ?? (mentiDisc ? 1 : 0.5)`) mentiDisc
    // dolu olduğu için 1 döndürüyor — API "tam güven" diyor, oysa vektör hiç kullanılmadı.
    expect(totalWithBrokenVector.confidence).toBe(1);

    const answers = Array.from({ length: 6 }, (_, i) => ({
      questionId: i + 1,
      selectedOption: 'A',
    }));
    const result = calculateDiscResult(answers);
    const fixedVector: DiscVector = { ...result.vector, confidence: result.confidence };

    const totalWithFixedVector = computeTotalScore({
      mentiTags: ['yazilim'],
      mentorTags: ['yazilim'],
      mentiDisc: 'D',
      mentorDisc: 'C',
      mentiVector: fixedVector,
    });
    // Düzeltilmiş akışta confidence artık gerçek onboarding oranını (6/8 = 0.75) yansıtır.
    expect(totalWithFixedVector.confidence).toBeCloseTo(0.75, 5);
  });
});
