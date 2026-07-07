import { CertificationStatus } from '@prisma/client';
import { prisma } from '../db.js';

const MAX_RAW_SCORE_PER_Q = 3;
const PASS_THRESHOLD      = 65;   // %65 ve üzeri geçer
const STARTING_MULTIPLIER = 1.0;  // sertifika alındığında kalite çarpanı sıfırlanır
const COOLDOWN_ATTEMPTS   = 2;    // kaç başarısız denemeden sonra bekleme süresi başlar
const COOLDOWN_HOURS      = 24;   // bekleme süresi (saat)

export interface CertAnswer {
  questionCode: string;
  optionKey: string;
}

export type CertFailReason =
  | 'BELOW_THRESHOLD'
  | 'RED_LINE_VIOLATION'
  | 'COOLDOWN_ACTIVE'
  | null;

export interface CertResult {
  certScore: number;
  passed: boolean;
  status: CertificationStatus;
  qualityMultiplier: number;
  failReason: CertFailReason;
  cooldownUntil: Date | null;
  attempts: number;
}

/**
 * Sertifikasyon değerlendirmesi.
 *
 * Tüm sertifikasyon durumu TenantMembership'te saklanır (per-tenant).
 * UserProfile cert alanları bu fonksiyon tarafından kullanılmaz.
 *
 * Geçiş koşulları (İKİSİ BİRDEN sağlanmalı):
 *   1. certScore >= 65
 *   2. Hiçbir kırmızı-çizgi sorusunda competencyScore=0 seçilmemiş olmalı
 *
 * Cooldown:
 *   - 2. başarısız denemeden sonra 24 saat bekleme
 *   - Cooldown süresi dolunca deneme sayacı sıfırlanır (2 taze hak)
 */
export async function evaluateCertification(
  userId: string,
  tenantId: string,
  answers: CertAnswer[],
): Promise<CertResult> {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error('answers must be a non-empty array.');
  }

  // Sertifikasyon verisi TenantMembership'ten okunur (per-tenant).
  const membership = await prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
  });
  if (!membership) {
    throw new Error(`TenantMembership bulunamadı: userId=${userId} tenantId=${tenantId}`);
  }

  // ── Cooldown aktifse değerlendirme yapma ────────────────────────────────────
  if (membership.cooldownUntil && membership.cooldownUntil > new Date()) {
    return {
      certScore:         membership.certScore ?? 0,
      passed:            false,
      status:            CertificationStatus.COOLDOWN,
      qualityMultiplier: membership.qualityMultiplier,
      failReason:        'COOLDOWN_ACTIVE',
      cooldownUntil:     membership.cooldownUntil,
      attempts:          membership.certAttempts,
    };
  }

  // ── Soru & seçenek verisi ───────────────────────────────────────────────────
  const codes     = [...new Set(answers.map((a) => a.questionCode))];
  const questions = await prisma.certificationQuestion.findMany({
    where:   { code: { in: codes }, isActive: true },
    include: { options: true },
  });
  const byCode = new Map(questions.map((q) => [q.code, q]));

  const totalActive = await prisma.certificationQuestion.count({ where: { isActive: true } });
  const maxScore    = totalActive * MAX_RAW_SCORE_PER_Q;

  // ── Puanlama ────────────────────────────────────────────────────────────────
  let raw = 0;
  let redLineViolated = false;

  for (const ans of answers) {
    const q   = byCode.get(ans.questionCode);
    if (!q) continue;
    const opt = q.options.find((o) => o.key === ans.optionKey);
    if (!opt) continue;
    raw += opt.competencyScore;
    if (q.isRedLine && opt.competencyScore === 0) redLineViolated = true;
  }

  const certScore      = maxScore > 0 ? Math.round((raw / maxScore) * 100 * 100) / 100 : 0;
  const meetsThreshold = certScore >= PASS_THRESHOLD;
  const passed         = meetsThreshold && !redLineViolated;

  const failReason: CertFailReason = passed
    ? null
    : redLineViolated
      ? 'RED_LINE_VIOLATION'
      : 'BELOW_THRESHOLD';

  // ── Deneme sayacı: cooldown süresi dolduysa sıfırla ────────────────────────
  // Böylece her cooldown sonrası kullanıcı 2 taze hak kazanır.
  const baseAttempts = (membership.cooldownUntil && membership.cooldownUntil <= new Date())
    ? 0
    : membership.certAttempts;
  const newAttempts = baseAttempts + 1;

  // ── Durum ve yeni cooldown ──────────────────────────────────────────────────
  let cooldownUntil: Date | null = null;
  let status: CertificationStatus;

  if (passed) {
    status = CertificationStatus.CERTIFIED;
  } else if (newAttempts >= COOLDOWN_ATTEMPTS) {
    cooldownUntil = new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000);
    status        = CertificationStatus.COOLDOWN;
  } else {
    status = CertificationStatus.FAILED;
  }

  // ── TenantMembership'e yaz (UserProfile'a yazmıyoruz) ─────────────────────
  await prisma.tenantMembership.update({
    where: { userId_tenantId: { userId, tenantId } },
    data: {
      certScore,
      isCertified:         passed,
      certificationStatus: status,
      certifiedAt:         passed ? new Date() : null,
      certAttempts:        newAttempts,
      cooldownUntil,
      ...(passed ? { qualityMultiplier: STARTING_MULTIPLIER } : {}),
    },
  });

  return {
    certScore,
    passed,
    status,
    qualityMultiplier: passed ? STARTING_MULTIPLIER : membership.qualityMultiplier,
    failReason,
    cooldownUntil,
    attempts: newAttempts,
  };
}
