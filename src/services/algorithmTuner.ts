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

// ─── Manuel ağırlık ayarı (9a) — kurum yöneticisi elle ayarlar ────────────────

/**
 * Manuel ayar doğrulama sonucu — saf fonksiyon (DB/HTTP bağımsız), birim testi kolay.
 * ok=false ise `error` Türkçe kullanıcı mesajı içerir.
 */
export type ManualWeightValidation =
  | { ok: true; sectorWeight: number; discWeight: number }
  | { ok: false; error: string };

/**
 * Manuel sektör ağırlığını doğrular. PO kuralları:
 *  - 0.05'in katı olmalı (küsürat reddedilir)
 *  - MIN_SECTOR_WEIGHT (0.40) ≤ sectorWeight ≤ MAX_SECTOR_WEIGHT (0.70)
 *  - discWeight = 1 - sectorWeight otomatik türetilir (toplam HEP 1.00 garantisi)
 *
 * Yalnız sectorWeight alınır; discWeight girdiden ALINMAZ, türetilir — böylece
 * "toplam ≠ 1.00" durumu yapısal olarak imkânsız. Girdi discWeight de gönderirse
 * türetilenle çelişki denetlenir (bozuk UI sessizce kabul edilmesin).
 */
export function validateManualWeights(input: {
  sectorWeight: unknown;
  discWeight?: unknown;
}): ManualWeightValidation {
  const sector = input.sectorWeight;
  if (typeof sector !== 'number' || !Number.isFinite(sector)) {
    return { ok: false, error: 'Sektör ağırlığı geçerli bir sayı olmalıdır.' };
  }

  // 0.05'in katı mı? Float kaymasını önlemek için tam-sayı aritmetiği (x100).
  const scaled = Math.round(sector * 100);
  if (Math.abs(sector * 100 - scaled) > 1e-6 || scaled % (STEP * 100) !== 0) {
    return { ok: false, error: "Ağırlık %5'in katı olmalıdır." };
  }

  if (sector < MIN_SECTOR_WEIGHT || sector > MAX_SECTOR_WEIGHT) {
    return {
      ok: false,
      error: `Sektör ağırlığı %${MIN_SECTOR_WEIGHT * 100}-%${MAX_SECTOR_WEIGHT * 100} arasında olmalıdır.`,
    };
  }

  const disc = Math.round((1 - sector) * 100) / 100;

  // İstemci discWeight de gönderdiyse türetilenle tutarlı mı?
  if (input.discWeight !== undefined) {
    const givenDisc = input.discWeight;
    if (typeof givenDisc !== 'number' || Math.abs(givenDisc - disc) > 1e-6) {
      return { ok: false, error: 'Sektör ve DISC ağırlıklarının toplamı %100 olmalıdır.' };
    }
  }

  return { ok: true, sectorWeight: Math.round(sector * 100) / 100, discWeight: disc };
}

export type ManualWeightResult = {
  previousWeights: AlgorithmWeights;
  newWeights: AlgorithmWeights;
  pendingCleared: boolean;
};

/**
 * Kurum yöneticisinin manuel ağırlık ayarını uygular (yalnız verilen tenant için).
 * Bekleyen otomatik kalibrasyon önerisi (pendingAlgorithmAdjustment) VARSA temizlenir:
 * admin zaten elle karar verdi; bekleyen ML önerisiyle çelişmemesi için (bkz. rejectPendingAdjustment).
 * Doğrulama ÇAĞIRAN katmanda (controller) yapılır — buraya yalnız doğrulanmış değer gelir.
 */
export async function setManualWeights(
  tenantId: string,
  sectorWeight: number,
  discWeight: number,
): Promise<ManualWeightResult> {
  const previous = await getAlgorithmWeights(tenantId);

  const newWeights: AlgorithmWeights = {
    sectorWeight,
    discWeight,
    lastAdjustedAt: new Date().toISOString(),
    reason: 'Kurum yöneticisi tarafından manuel ayarlandı',
  };

  // Ağırlığı yaz + bekleyen otomatik öneriyi tek update'te temizle (tenant-scoped).
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tenantVocabulary: true },
  });
  const existing = (tenant?.tenantVocabulary as Record<string, unknown>) ?? {};
  const pendingCleared = existing['pendingAlgorithmAdjustment'] !== undefined;
  delete existing['pendingAlgorithmAdjustment'];

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { tenantVocabulary: { ...existing, algorithmWeights: newWeights } },
  });

  return { previousWeights: previous, newWeights, pendingCleared };
}

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

    // Artık direkt uygulamıyoruz — yönetici onayına gönderiyoruz
    await savePendingAdjustment(tenantId, result);
    await notifyAdminsAboutPendingAdjustment(tenantId, result);

    void logger.info('ML', `Algoritma kalibrasyon önerisi hazırlandı, yönetici onayı bekleniyor: tenant=${tenantId}`, {
      previousSectorWeight: current.sectorWeight,
      proposedSectorWeight: newSectorWeight,
      reason,
    });
  } else {
    result.reason = reason;
  }

  return result;
}

// ─── Yönetici Onay Mekanizması ────────────────────────────────────────────────

export type PendingAdjustment = TuningResult & { proposedAt: string };

async function savePendingAdjustment(tenantId: string, result: TuningResult): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tenantVocabulary: true },
  });
  const existing = (tenant?.tenantVocabulary as Record<string, unknown>) ?? {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      tenantVocabulary: {
        ...existing,
        pendingAlgorithmAdjustment: { ...result, proposedAt: new Date().toISOString() },
      },
    },
  });
}

export async function getPendingAdjustment(tenantId: string): Promise<PendingAdjustment | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tenantVocabulary: true },
  });
  const vocab = tenant?.tenantVocabulary as Record<string, unknown> | null;
  return (vocab?.pendingAlgorithmAdjustment as PendingAdjustment) ?? null;
}

/** Admin onayladığında çağrılır — ağırlıkları uygular ve pending'i temizler. */
export async function applyPendingAdjustment(tenantId: string): Promise<PendingAdjustment | null> {
  const pending = await getPendingAdjustment(tenantId);
  if (!pending) return null;

  await saveAlgorithmWeights(tenantId, pending.newWeights);

  // Pending'i temizle
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { tenantVocabulary: true } });
  const existing = (tenant?.tenantVocabulary as Record<string, unknown>) ?? {};
  delete existing['pendingAlgorithmAdjustment'];
  await prisma.tenant.update({ where: { id: tenantId }, data: { tenantVocabulary: existing } });

  void logger.info('ML', `Admin onayıyla algoritma ağırlıkları uygulandı: tenant=${tenantId}`, {
    newSectorWeight: pending.newWeights.sectorWeight,
    reason: pending.reason,
  });

  return pending;
}

/** Admin reddederse pending'i sil, ağırlıklara dokunma. */
export async function rejectPendingAdjustment(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { tenantVocabulary: true } });
  const existing = (tenant?.tenantVocabulary as Record<string, unknown>) ?? {};
  delete existing['pendingAlgorithmAdjustment'];
  await prisma.tenant.update({ where: { id: tenantId }, data: { tenantVocabulary: existing } });
  void logger.info('ML', `Admin kalibrasyon önerisini reddetti: tenant=${tenantId}`);
}

async function notifyAdminsAboutPendingAdjustment(tenantId: string, result: TuningResult): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { tenantId, role: 'ADMIN', isActive: true },
    select: { email: true, fullName: true },
  });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { displayName: true, name: true } });
  const tenantName = tenant?.displayName ?? tenant?.name ?? tenantId;

  const prevSector = Math.round(result.previousWeights.sectorWeight * 100);
  const newSector  = Math.round(result.newWeights.sectorWeight * 100);
  const prevDisc   = 100 - prevSector;
  const newDisc    = 100 - newSector;

  const { sendAlgorithmAdjustmentProposal } = await import('./emailService.js');
  for (const admin of admins) {
    void sendAlgorithmAdjustmentProposal({
      toEmail:    admin.email,
      adminName:  admin.fullName,
      tenantName,
      tenantId,
      reason:     result.reason,
      phase1Nps:  result.phase1Nps.avgNps,
      phase3Nps:  result.phase3Nps.avgNps,
      prevSector, prevDisc,
      newSector,  newDisc,
    });
  }
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
