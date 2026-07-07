/**
 * Algoritma Ağırlık Ayarlayıcı (Feedback Loop Agent)
 *
 * 60/40 (sektör/DISC) ağırlığı NPS verilerine göre tenant bazında ayarlanır.
 * Phase 1 = 1. ay NPS, Phase 3 = 3. ay NPS.
 *
 * Ağırlık ayarlama kuralları:
 *   - 3. ay NPS yüksekse (≥70) mevcut ağırlıklar korunur
 *   - 3. ay NPS düşükse (<50) DISC ağırlığı +5 (max 60) → DISC'e daha fazla güven
 *   - 1. ay NPS yüksek ama 3. ay düşükse uzun vadeli uyum zayıf → DISC +5
 *   - Değişim her zaman ±5 adımlarda olur (ani kaymayı önlemek için)
 *
 * Ağırlıklar MatchCombinationScore.score tablosuna yazılmaz;
 * tenant-level bir config kaydı olarak Tenant.tenantVocabulary içinde saklanır.
 * (Production'da ayrı bir AlgorithmConfig tablosu önerilir.)
 */

import { prisma } from '../db.js';
import { logger } from './logger.js';

export type AlgorithmWeights = {
  sectorWeight: number;   // 0-1 (varsayılan: 0.60)
  discWeight: number;     // 0-1 (varsayılan: 0.40)
  lastAdjustedAt: string; // ISO 8601
  reason: string;
};

const DEFAULT_WEIGHTS: AlgorithmWeights = {
  sectorWeight: 0.60,
  discWeight: 0.40,
  lastAdjustedAt: new Date().toISOString(),
  reason: 'Varsayılan ağırlıklar',
};

const MIN_SECTOR_WEIGHT = 0.40;
const MAX_SECTOR_WEIGHT = 0.70;
const STEP = 0.05;

// ─── NPS istatistikleri ───────────────────────────────────────────────────────

type NpsStats = {
  avgNps: number | null;
  sampleSize: number;
};

async function getNpsStats(tenantId: string, phase: number): Promise<NpsStats> {
  const logs = await prisma.feedbackLog.findMany({
    where: {
      tenantId,
      phase,
      npsScore: { not: null },
    },
    select: { npsScore: true },
  });

  if (logs.length === 0) return { avgNps: null, sampleSize: 0 };

  const total = logs.reduce((sum, l) => sum + (l.npsScore ?? 0), 0);
  return {
    avgNps: Math.round(total / logs.length),
    sampleSize: logs.length,
  };
}

// ─── Ağırlık okuma/yazma ──────────────────────────────────────────────────────

export async function getAlgorithmWeights(tenantId: string): Promise<AlgorithmWeights> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tenantVocabulary: true },
  });

  const vocab = tenant?.tenantVocabulary as Record<string, unknown> | null;
  const stored = vocab?.algorithmWeights as AlgorithmWeights | undefined;
  return stored ?? { ...DEFAULT_WEIGHTS };
}

async function saveAlgorithmWeights(tenantId: string, weights: AlgorithmWeights): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tenantVocabulary: true },
  });

  const existing = (tenant?.tenantVocabulary as Record<string, unknown>) ?? {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      tenantVocabulary: { ...existing, algorithmWeights: weights },
    },
  });
}

// ─── Ana ayarlama motoru ──────────────────────────────────────────────────────

export type TuningResult = {
  tenantId: string;
  previousWeights: AlgorithmWeights;
  newWeights: AlgorithmWeights;
  phase1Nps: NpsStats;
  phase3Nps: NpsStats;
  adjusted: boolean;
  reason: string;
};

export async function tuneScoringWeights(tenantId: string): Promise<TuningResult> {
  const [phase1Nps, phase3Nps, current] = await Promise.all([
    getNpsStats(tenantId, 1),
    getNpsStats(tenantId, 3),
    getAlgorithmWeights(tenantId),
  ]);

  const result: TuningResult = {
    tenantId,
    previousWeights: { ...current },
    newWeights: { ...current },
    phase1Nps,
    phase3Nps,
    adjusted: false,
    reason: 'Yeterli NPS verisi yok — ağırlıklar değişmedi',
  };

  // Minimum 10 yanıt şartı (istatistiksel anlamlılık)
  if (!phase3Nps.avgNps || phase3Nps.sampleSize < 10) {
    return result;
  }

  let newSectorWeight = current.sectorWeight;
  let reason = '';

  if (phase3Nps.avgNps >= 70) {
    // 3. ay NPS yüksek → mevcut strateji çalışıyor, değişiklik yok
    reason = `3. ay NPS ${phase3Nps.avgNps} — strateji başarılı, ağırlıklar korunuyor`;
  } else if (phase3Nps.avgNps < 50) {
    // Uzun vadeli uyum zayıf → DISC ağırlığını artır (sektörü azalt)
    newSectorWeight = Math.max(MIN_SECTOR_WEIGHT, current.sectorWeight - STEP);
    reason = `3. ay NPS ${phase3Nps.avgNps} (< 50) — DISC ağırlığı +${STEP * 100}% artırıldı`;
  } else if (phase1Nps.avgNps !== null && phase1Nps.avgNps >= 70 && phase3Nps.avgNps < 60) {
    // 1. ay iyi başladı ama 3. ay düştü → uzun vadeli uyum sorunu
    newSectorWeight = Math.max(MIN_SECTOR_WEIGHT, current.sectorWeight - STEP);
    reason = `1. ay NPS ${phase1Nps.avgNps} → 3. ay NPS ${phase3Nps.avgNps} düşüşü — DISC ağırlığı +${STEP * 100}%`;
  } else {
    // Orta performans → sektöre biraz daha ağırlık ver
    newSectorWeight = Math.min(MAX_SECTOR_WEIGHT, current.sectorWeight + STEP);
    reason = `3. ay NPS ${phase3Nps.avgNps} (50-70 arası) — sektör ağırlığı +${STEP * 100}%`;
  }

  const newDiscWeight = Math.round((1 - newSectorWeight) * 100) / 100;

  if (newSectorWeight !== current.sectorWeight) {
    result.newWeights = {
      sectorWeight: newSectorWeight,
      discWeight: newDiscWeight,
      lastAdjustedAt: new Date().toISOString(),
      reason,
    };
    result.adjusted = true;
    result.reason = reason;

    await saveAlgorithmWeights(tenantId, result.newWeights);
    void logger.info('ML', `Algoritma ağırlıkları ayarlandı: tenant=${tenantId}`, {
      previousSectorWeight: current.sectorWeight,
      newSectorWeight,
      reason,
    });
  } else {
    result.reason = reason;
  }

  return result;
}

/**
 * Tüm tenant'lar için toplu ağırlık ayarlaması çalıştırır.
 * Cron job'dan veya admin endpoint'inden tetiklenir (ADIM 11'de entegre edilir).
 */
export async function runGlobalTuning(): Promise<TuningResult[]> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  const results: TuningResult[] = [];

  for (const tenant of tenants) {
    try {
      const result = await tuneScoringWeights(tenant.id);
      results.push(result);
    } catch (err) {
      void logger.error('ML', `Tenant ${tenant.id} ağırlık ayarlaması başarısız`, {
        error: String(err),
      });
    }
  }

  return results;
}
