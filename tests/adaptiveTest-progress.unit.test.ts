/**
 * adaptiveTestEngine — computeProgress birim testleri (madde 70).
 *
 * Amaç (P1 regresyon): adaptif-test yanıtına eklenen `progress` sözleşmesinin
 * doğru hesaplandığını DB'siz kanıtlamak. Frontend faz kararı (CORE→DEEPENING→
 * COMPLETE) ve ilerleme çubuğu bu nesneye bağlıdır; yanlış sayım UI'yi bozar.
 *
 * Saf mantık — globalSetup/DB bağlantısı gerektirmez:
 *   npx vitest run tests/adaptiveTest-progress.unit.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeProgress } from '../src/services/adaptiveTestEngine.js';

describe('computeProgress — adaptif ilerleme özeti (madde 70)', () => {
  it('CORE fazı: eşik altı → isDeepening=false, isComplete=false, yüzde CORE üzerinden', () => {
    // 2/10 CORE yanıtlandı, deepening henüz açık değil (total=0)
    const p = computeProgress(2, 10, 0, 0, false);
    expect(p.totalAnswered).toBe(2);
    expect(p.coreAnswered).toBe(2);
    expect(p.deepeningAnswered).toBe(0);
    expect(p.coreThreshold).toBe(5);
    expect(p.isDeepening).toBe(false);
    expect(p.isComplete).toBe(false);
    expect(p.completionPercent).toBe(20);
  });

  it('CORE eşiği tam karşılandı ama deepening başlamadı → isDeepening deepening cevabı olmadan da true (eşik geçildi, bitmedi)', () => {
    // 5/5 CORE bitti, deepening 0/4 → faz DEEPENING'e geçti ama henüz cevap yok
    const p = computeProgress(5, 5, 0, 4, false);
    expect(p.isDeepening).toBe(true);
    expect(p.isComplete).toBe(false);
    expect(p.totalAnswered).toBe(5);
    // 5 / (5+4)=9 → %56 (yuvarlanır)
    expect(p.completionPercent).toBe(56);
  });

  it('DEEPENING fazı: kısmi ilerleme → answered ve yüzde doğru', () => {
    // 5 CORE + 2/4 deepening = 7 yanıt, max 9
    const p = computeProgress(5, 5, 2, 4, false);
    expect(p.totalAnswered).toBe(7);
    expect(p.deepeningAnswered).toBe(2);
    expect(p.isDeepening).toBe(true);
    expect(p.completionPercent).toBe(78); // 7/9=0.777→78
  });

  it('tamamlandı → isComplete=true, isDeepening=false, yüzde 100', () => {
    const p = computeProgress(5, 5, 4, 4, true);
    expect(p.isComplete).toBe(true);
    expect(p.isDeepening).toBe(false);
    expect(p.completionPercent).toBe(100);
    expect(p.totalAnswered).toBe(9);
  });

  it('yüzde 100 ile sınırlanır ve sıfıra bölme olmaz (soru yok)', () => {
    // toplam soru 0 → maxPossible en az 1, çökmez
    const p = computeProgress(0, 0, 0, 0, false);
    expect(p.completionPercent).toBe(0);
    expect(Number.isFinite(p.completionPercent)).toBe(true);
  });
});
