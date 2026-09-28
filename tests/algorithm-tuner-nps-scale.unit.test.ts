/**
 * KR-07 — Ağırlık ayarlayıcının NPS ölçeği BİRİM testleri (DB bağımsız).
 *
 * FeedbackLog.npsScore 0-10'dur (feedbackLogController şeması). İlk sürüm ortalamayı 70/50/60
 * (0-100) eşikleriyle kıyaslıyordu → her ortalama "< 50" sayılıp DISC ağırlığı hep artıyordu.
 * Bu testler eşiklerin 0-10 ölçeğinde çalıştığını ve eski hatanın geri gelmediğini kanıtlar.
 *
 *   npx vitest run tests/algorithm-tuner-nps-scale.unit.test.ts --reporter=verbose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// AJ-69: servis akışı (tuneScoringWeights / getPendingAdjustment) DB'siz koşsun diye prisma,
// logger ve e-posta modülü taklit edilir. Saf fonksiyon testleri bu taklitlerden etkilenmez.
const mocks = vi.hoisted(() => ({
  feedbackLogFindMany: vi.fn(),
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
  userFindMany: vi.fn(),
  sendAlgorithmAdjustmentProposal: vi.fn(),
}));
vi.mock('../src/db.js', () => ({
  prisma: {
    feedbackLog: { findMany: mocks.feedbackLogFindMany },
    tenant: { findUnique: mocks.tenantFindUnique, update: mocks.tenantUpdate },
    user: { findMany: mocks.userFindMany },
  },
}));
vi.mock('../src/services/logger.js', () => ({
  logger: { info: vi.fn().mockResolvedValue(undefined), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/emailService.js', () => ({
  sendAlgorithmAdjustmentProposal: mocks.sendAlgorithmAdjustmentProposal,
}));

import {
  decideSectorWeight,
  NPS_THRESHOLDS,
  tuneScoringWeights,
  getPendingAdjustment,
  getAlgorithmWeights,
  redactPhase1AverageFromReason,
} from '../src/services/algorithmTuner.js';
import { maskNpsSample, formatNpsSample, K_ANONYMITY_THRESHOLD } from '../src/services/mask.js';

const base = { phase1AvgNps: null, phase3SampleSize: 10, currentSectorWeight: 0.6 };

const HIDDEN = { avgNps: null, sampleSize: 0, suppressed: true, minSampleSize: K_ANONYMITY_THRESHOLD };

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

// ─── AJ-69: küçük örnekte NPS ortalaması gösterilmez (k-anonimlik, V-05 kalanı) ───────────────

describe('AJ-69 maskNpsSample: eşik altı ortalama dönmez', () => {
  it('eşik sabiti 3 (mask.ts K_ANONYMITY_THRESHOLD) — yeni sihirli sayı yok', () => {
    expect(K_ANONYMITY_THRESHOLD).toBe(3);
  });

  it('n=1 ve n=2 → ortalama null, sayı 0, gizli', () => {
    expect(maskNpsSample({ avgNps: 9, sampleSize: 1 })).toEqual(HIDDEN);
    expect(maskNpsSample({ avgNps: 4.5, sampleSize: 2 })).toEqual(HIDDEN);
  });

  it('n=3 → ortalama ve sayı döner', () => {
    expect(maskNpsSample({ avgNps: 7.3, sampleSize: 3 })).toEqual({
      avgNps: 7.3, sampleSize: 3, suppressed: false, minSampleSize: K_ANONYMITY_THRESHOLD,
    });
  });

  it('hiç yanıt yok → gizli DEĞİL, veri yok; önceden maskelenmiş kayıt yeniden maskelenince gizli kalır', () => {
    expect(maskNpsSample({ avgNps: null, sampleSize: 0 })).toEqual({
      avgNps: null, sampleSize: 0, suppressed: false, minSampleSize: K_ANONYMITY_THRESHOLD,
    });
    expect(maskNpsSample(HIDDEN)).toEqual(HIDDEN);
  });

  it('formatNpsSample ham veri verilse bile ortalamayı yazmaz', () => {
    expect(formatNpsSample({ avgNps: 9, sampleSize: 2 })).toBe('gizli (<3 yanıt)');
    expect(formatNpsSample({ avgNps: 9, sampleSize: 3 })).toBe('9');
    expect(formatNpsSample({ avgNps: null, sampleSize: 0 })).toBe('Yetersiz veri');
  });
});

describe('AJ-69 gerekçe metni 1. ay ortalamasını taşımaz', () => {
  it('düşüş dalı: gerekçede 1. ay ortalaması yok, 3. ay ortalaması var; karar aynı (DISC +5)', () => {
    const r = decideSectorWeight({ ...base, phase1AvgNps: 9.4, phase3AvgNps: 5.5 });
    expect(r?.newSectorWeight).toBeCloseTo(0.55);
    expect(r?.reason).not.toContain('9.4');
    expect(r?.reason).toContain('5.5/10');
  });

  it('eski kayıt gerekçesi okuma anında dönüştürülür', () => {
    const legacy = '1. ay ortalama NPS 9.4/10 → 3. ay 5.5/10 düşüşü — DISC ağırlığı +5%';
    const out = redactPhase1AverageFromReason(legacy);
    expect(out).not.toContain('9.4');
    expect(out).toContain('3. ay ortalama 5.5/10');
    expect(out).toContain('DISC ağırlığı +5%');
    // Düşüş dalı dışındaki gerekçeler aynen kalır.
    const other = '3. ay ortalama NPS 4/10 (< 5) — DISC ağırlığı +5% artırıldı';
    expect(redactPhase1AverageFromReason(other)).toBe(other);
  });
});

/** phase → puan listesi; feedbackLog.findMany taklidi `where.phase`'e göre döner. */
function givenScores(byPhase: Record<number, number[]>) {
  mocks.feedbackLogFindMany.mockImplementation(async ({ where }: { where: { phase: number } }) =>
    (byPhase[where.phase] ?? []).map((npsScore) => ({ npsScore })),
  );
}

describe('AJ-69 tuneScoringWeights: dışarı çıkan sonuç, kayıt ve e-posta maskeli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantFindUnique.mockResolvedValue({ tenantVocabulary: {}, displayName: 'Kurum', name: 'kurum' });
    mocks.tenantUpdate.mockResolvedValue({});
    mocks.userFindMany.mockResolvedValue([{ id: 'a1', email: 'yonetici@ornek.org', fullName: 'Yönetici' }]);
    mocks.sendAlgorithmAdjustmentProposal.mockResolvedValue(undefined);
  });

  for (const n of [1, 2]) {
    it(`1. ay n=${n} (ortalama 9) → sonuçta, kayıtlı öneride ve e-postada ortalama YOK; karar değişmedi`, async () => {
      givenScores({ 1: Array(n).fill(9), 3: Array(10).fill(5) });
      const result = await tuneScoringWeights('t1');

      expect(result.phase1Nps).toEqual(HIDDEN);
      expect(result.phase3Nps).toEqual({ avgNps: 5, sampleSize: 10, suppressed: false, minSampleSize: 3 });
      // Karar mantığı HAM ortalamayla verilir → düşüş dalı yine seçilir (davranış korunur).
      expect(result.adjusted).toBe(true);
      expect(result.newWeights.sectorWeight).toBeCloseTo(0.55);
      expect(result.reason).not.toMatch(/\b9\b/);

      const saved = mocks.tenantUpdate.mock.calls[0]![0] as {
        data: { tenantVocabulary: { pendingAlgorithmAdjustment: Record<string, unknown> } };
      };
      const pending = saved.data.tenantVocabulary.pendingAlgorithmAdjustment;
      expect(pending['phase1Nps']).toEqual(HIDDEN);
      expect(JSON.stringify(pending)).not.toMatch(/\b9\b/);

      const emailArgs = mocks.sendAlgorithmAdjustmentProposal.mock.calls[0]![0] as { phase1Nps: unknown; reason: string };
      expect(emailArgs.phase1Nps).toEqual(HIDDEN);
      expect(emailArgs.reason).not.toMatch(/\b9\b/);
    });
  }

  it('1. ay n=3 → ortalama ve sayı döner', async () => {
    givenScores({ 1: [9, 9, 9], 3: Array(10).fill(5) });
    const result = await tuneScoringWeights('t1');
    expect(result.phase1Nps).toEqual({ avgNps: 9, sampleSize: 3, suppressed: false, minSampleSize: 3 });
    expect(result.newWeights.sectorWeight).toBeCloseTo(0.55);
  });
});

describe('AJ-69 kayıtlı eski öneri OKUNURKEN maskelenir (API: GET /algorithm-tuner/pending)', () => {
  const legacyReason = '1. ay ortalama NPS 9/10 → 3. ay 5/10 düşüşü — DISC ağırlığı +5%';
  const legacyPending = (phase1SampleSize: number) => ({
    tenantId: 't1',
    previousWeights: { sectorWeight: 0.6, discWeight: 0.4, lastAdjustedAt: '2026-09-01T00:00:00.000Z', reason: 'Varsayılan ağırlıklar' },
    newWeights: { sectorWeight: 0.55, discWeight: 0.45, lastAdjustedAt: '2026-09-02T00:00:00.000Z', reason: legacyReason },
    phase1Nps: { avgNps: 9, sampleSize: phase1SampleSize },
    phase3Nps: { avgNps: 5, sampleSize: 10 },
    adjusted: true,
    reason: legacyReason,
    proposedAt: '2026-09-02T00:00:00.000Z',
  });

  beforeEach(() => vi.clearAllMocks());

  for (const n of [1, 2]) {
    it(`AJ-69 öncesi ham kayıt, 1. ay n=${n} → ortalama ve gerekçedeki 1. ay değeri dönmez`, async () => {
      mocks.tenantFindUnique.mockResolvedValue({ tenantVocabulary: { pendingAlgorithmAdjustment: legacyPending(n) } });
      const pending = await getPendingAdjustment('t1');
      expect(pending?.phase1Nps).toEqual(HIDDEN);
      expect(pending?.phase3Nps.avgNps).toBe(5);
      expect(JSON.stringify(pending)).not.toContain('9/10');
      expect(pending?.reason).toContain('3. ay ortalama 5/10');
    });
  }

  it('ham kayıt, 1. ay n=3 → 1. ay ortalaması alanında döner', async () => {
    mocks.tenantFindUnique.mockResolvedValue({ tenantVocabulary: { pendingAlgorithmAdjustment: legacyPending(3) } });
    const pending = await getPendingAdjustment('t1');
    expect(pending?.phase1Nps).toEqual({ avgNps: 9, sampleSize: 3, suppressed: false, minSampleSize: 3 });
  });

  it('uygulanmış eski ağırlığın gerekçesi ("Son değişiklik" satırı) 1. ay ortalamasını taşımaz', async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      tenantVocabulary: { algorithmWeights: legacyPending(1).newWeights },
    });
    const weights = await getAlgorithmWeights('t1');
    expect(weights.reason).not.toContain('9/10');
    expect(weights.sectorWeight).toBe(0.55);
  });
});
