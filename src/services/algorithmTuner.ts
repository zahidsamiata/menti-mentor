/**
 * Algoritma Ağırlık Ayarlayıcı (Feedback Loop Agent)
 *
 * 60/40 (sektör/DISC) ağırlığı NPS verilerine göre tenant bazında ayarlanır.
 * Phase 1 = 1. ay NPS, Phase 3 = 3. ay NPS.
 *
 * Ağırlık ayarlama kuralları:
 *   - 3. ay ortalama NPS yüksekse (≥7) mevcut ağırlıklar korunur
 *   - 3. ay ortalama NPS düşükse (<5) DISC ağırlığı +5 (max 60) → DISC'e daha fazla güven
 *   - 1. ay yüksek (≥7) ama 3. ay <6 ise uzun vadeli uyum zayıf → DISC +5
 *   (Eşikler NPS_THRESHOLDS'ta; "NPS" burada FeedbackLog.npsScore'un 0-10 ORTALAMASIDIR,
 *   promoter%−detractor% ile hesaplanan klasik NPS değildir.)
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

/**
 * Ortalama NPS eşikleri — 0-10 ölçeğinde (FeedbackLog.npsScore, feedbackLogController şeması
 * `z.number().int().min(0).max(10)`).
 *
 * Neden 7/5/6: ilk sürüm eşikleri 70/50/60 olarak 0-100 ölçeğinde yazılmıştı; oysa puan 0-10'dur,
 * dolayısıyla ortalama asla 50'yi geçemiyor ve ayarlayıcı veri geldiğinde HER ZAMAN "düşük → DISC +5"
 * dalına düşüyordu (KR-07). Ürün niyeti (70/100 = "iyi", 50/100 = "kötü") oran korunarak 0-10'a
 * taşındı: 70→7, 50→5, 60→6. Yeni bir eşik seçilmedi; yalnız ölçek düzeltildi.
 */
export const NPS_THRESHOLDS = {
  /** 3. ay ortalaması bu değer ve üstündeyse strateji başarılı sayılır, ağırlık korunur. */
  HIGH: 7,
  /** 3. ay ortalaması bunun altındaysa uzun vadeli uyum zayıf → DISC ağırlığı artar. */
  LOW: 5,
  /** 1. ay ≥ HIGH iken 3. ay bunun altına düştüyse "düşüş" sayılır → DISC ağırlığı artar. */
  PHASE3_DROP: 6,
} as const;

/** 3. ay için en az bu kadar yanıt yoksa ayar yapılmaz (istatistiksel anlamlılık). */
const MIN_PHASE3_SAMPLE = 10;

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
    // 0-10 ölçeğinde tam sayıya yuvarlamak eşik kararını bozar (6.5 → 7 "yüksek" sayılırdı;
    // 0-100 ölçeğindeki eşdeğeri 65 < 70). Tek ondalık hassasiyet korunur.
    avgNps: Math.round((total / logs.length) * 10) / 10,
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

// ─── Son değişiklik izi (95) — "kim / ne zaman / eski→yeni" ────────────────────

/**
 * AUDIT log mesajı — manuel ağırlık ayarında yazılır (setAlgorithmWeightsHandler) ve
 * son-değişiklik izini okumak için sorgulanır (getLastWeightChange). Tek kaynak = tek sabit
 * (sihirli-dize tekrarı yok; iki taraf hep aynı mesajı kullanır).
 */
export const WEIGHT_CHANGE_AUDIT_MESSAGE = 'Kurum yöneticisi eşleştirme ağırlığını manuel ayarladı';

/** Kalibrasyon sayfasındaki "son değişiklik" satırı için — kim/ne zaman/eski→yeni. */
export type WeightChangeInfo = {
  /** Aktörün ADI (e-posta DEĞİL — PII minimizasyonu). Silinmiş/anonimleştirilmiş/tenant-dışı ise null. */
  actorName: string | null;
  at: string; // ISO 8601 — değişiklik zamanı
  previousSectorWeight: number;
  previousDiscWeight: number;
  newSectorWeight: number;
  newDiscWeight: number;
};

/**
 * Verilen tenant'ın SON manuel ağırlık değişikliğinin izini döndürür (yoksa null).
 * Kaynak: SystemLog AUDIT kaydı (`meta.{actorUserId,tenantId,previousWeights,newWeights,timestamp}`).
 *
 * TENANT İZOLASYONU: SystemLog global tablodur (tenantId kolonu yok) → sorgu `meta.tenantId`
 * eşitliğiyle filtrelenir; aktör adı da yalnız AYNI tenant'tan çözülür (başka kurumun izi sızmaz).
 * PII minimizasyonu: yalnız `fullName` çözülür, e-posta okunmaz/döndürülmez.
 */
export async function getLastWeightChange(tenantId: string): Promise<WeightChangeInfo | null> {
  const log = await prisma.systemLog.findFirst({
    where: {
      category: 'AUDIT',
      message: WEIGHT_CHANGE_AUDIT_MESSAGE,
      meta: { path: ['tenantId'], equals: tenantId },
    },
    orderBy: { createdAt: 'desc' },
    select: { meta: true, createdAt: true },
  });
  if (!log?.meta) return null;

  const meta = log.meta as {
    actorUserId?: string | null;
    previousWeights?: AlgorithmWeights;
    newWeights?: AlgorithmWeights;
    timestamp?: string;
  };
  const prev = meta.previousWeights;
  const next = meta.newWeights;
  if (!prev || !next) return null;

  let actorName: string | null = null;
  if (meta.actorUserId) {
    const actor = await prisma.user.findFirst({
      where: { id: meta.actorUserId, tenantId }, // tenant-scoped — izolasyon
      select: { fullName: true },
    });
    actorName = actor?.fullName ?? null;
  }

  return {
    actorName,
    at: meta.timestamp ?? log.createdAt.toISOString(),
    previousSectorWeight: prev.sectorWeight,
    previousDiscWeight: prev.discWeight,
    newSectorWeight: next.sectorWeight,
    newDiscWeight: next.discWeight,
  };
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

/**
 * Ağırlık kararının saf çekirdeği (DB/HTTP bağımsız, birim testi kolay).
 * Yeterli 3. ay verisi yoksa null döner (ağırlık değişmez).
 * Formül (±STEP, MIN/MAX sınırları) değişmedi; yalnız eşikler 0-10 ölçeğine taşındı (NPS_THRESHOLDS).
 */
export function decideSectorWeight(input: {
  phase1AvgNps: number | null;
  phase3AvgNps: number | null;
  phase3SampleSize: number;
  currentSectorWeight: number;
}): { newSectorWeight: number; reason: string } | null {
  const { phase1AvgNps, phase3AvgNps, phase3SampleSize, currentSectorWeight } = input;
  // `=== null` (falsy değil): 0-10 ölçeğinde ortalama 0 geçerli bir "çok düşük" sinyalidir.
  if (phase3AvgNps === null || phase3SampleSize < MIN_PHASE3_SAMPLE) {
    return null;
  }

  const { HIGH, LOW, PHASE3_DROP } = NPS_THRESHOLDS;

  if (phase3AvgNps >= HIGH) {
    // 3. ay NPS yüksek → mevcut strateji çalışıyor, değişiklik yok
    return {
      newSectorWeight: currentSectorWeight,
      reason: `3. ay ortalama NPS ${phase3AvgNps}/10 — strateji başarılı, ağırlıklar korunuyor`,
    };
  }
  if (phase3AvgNps < LOW) {
    // Uzun vadeli uyum zayıf → DISC ağırlığını artır (sektörü azalt)
    return {
      newSectorWeight: Math.max(MIN_SECTOR_WEIGHT, currentSectorWeight - STEP),
      reason: `3. ay ortalama NPS ${phase3AvgNps}/10 (< ${LOW}) — DISC ağırlığı +${STEP * 100}% artırıldı`,
    };
  }
  if (phase1AvgNps !== null && phase1AvgNps >= HIGH && phase3AvgNps < PHASE3_DROP) {
    // 1. ay iyi başladı ama 3. ay düştü → uzun vadeli uyum sorunu
    return {
      newSectorWeight: Math.max(MIN_SECTOR_WEIGHT, currentSectorWeight - STEP),
      reason: `1. ay ortalama NPS ${phase1AvgNps}/10 → 3. ay ${phase3AvgNps}/10 düşüşü — DISC ağırlığı +${STEP * 100}%`,
    };
  }
  // Orta performans → sektöre biraz daha ağırlık ver
  return {
    newSectorWeight: Math.min(MAX_SECTOR_WEIGHT, currentSectorWeight + STEP),
    reason: `3. ay ortalama NPS ${phase3AvgNps}/10 (${LOW}-${HIGH} arası) — sektör ağırlığı +${STEP * 100}%`,
  };
}

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

  const decision = decideSectorWeight({
    phase1AvgNps: phase1Nps.avgNps,
    phase3AvgNps: phase3Nps.avgNps,
    phase3SampleSize: phase3Nps.sampleSize,
    currentSectorWeight: current.sectorWeight,
  });
  if (decision === null) {
    return result;
  }
  const { newSectorWeight, reason } = decision;

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
