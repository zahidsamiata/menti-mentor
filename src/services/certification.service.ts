import { CertificationStatus } from '@prisma/client';
import { prisma } from '../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// Sertifika değerlendirme motoru — "ilk-deneme oranı + red-line" modeli.
//
// Puanlama (senaryo bankası): her seçenek 0-3 (3=en doğru, 2=kabul edilebilir,
//   1=zayıf, 0=zararlı).
// İlk-deneme geçme kuralı (konu bazında, mentörün o konudaki İLK seçimi):
//   - Normal konu:  ilk seçim 3 veya 2 → geçer.
//   - Red-line konu: ilk seçim SADECE 3 → geçer.
// Sertifika eşiği: aktif konuların en az %80'inde ilk-denemede geçmek.
// Ceza/cooldown YOK — yanlışta UI aynı konunun farklı varyantını sunar (öğret, eleme).
//
// Tüm sertifika durumu TenantMembership'te saklanır (per-tenant).
// ─────────────────────────────────────────────────────────────────────────────

export const PASS_RATE_THRESHOLD  = 0.8;  // konuların en az %80'i ilk-denemede geçmeli (kalibre edilebilir)
const STARTING_MULTIPLIER         = 1.0;  // sertifika alınınca kalite çarpanı sıfırlanır

/** Bir seçeneğin ilk-denemede "geçer" olup olmadığı (konunun kritikliğine göre). */
export function isFirstAttemptPass(competencyScore: number, isRedLine: boolean): boolean {
  return isRedLine ? competencyScore === 3 : competencyScore >= 2;
}

export interface CertAnswer {
  questionCode: string;
  optionKey: string;
}

export type CertFailReason = 'BELOW_THRESHOLD' | null;

export interface CertTopicResult {
  topic: string;
  isRedLine: boolean;
  firstScore: number;
  passed: boolean;
}

export interface CertResult {
  certScore: number;        // ilk-deneme geçme oranı (0-100)
  passRate: number;         // 0-1
  totalTopics: number;
  passedTopics: number;
  passed: boolean;
  status: CertificationStatus;
  qualityMultiplier: number;
  failReason: CertFailReason;
  attempts: number;
  topicResults: CertTopicResult[];
}

/**
 * Sertifikayı değerlendirir ve sonucu TenantMembership'e yazar.
 *
 * @param answers Mentörün konu-bazında İLK seçimleri (sırayla). Aynı konudan
 *   birden fazla cevap gelirse yalnızca İLK'i (ilk-deneme) dikkate alınır;
 *   sonrakiler (öğrenme amaçlı varyant tekrarları) skora katılmaz.
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

  // Aktif soru havuzu (seçenek puanları + konu/kritiklik).
  const questions = await prisma.certificationQuestion.findMany({
    where:   { isActive: true },
    include: { options: true },
  });
  const byCode = new Map(questions.map((q) => [q.code, q]));

  // Toplam konu sayısı = aktif sorulardaki benzersiz (null olmayan) topic sayısı.
  const totalTopics = new Set(
    questions.map((q) => q.topic).filter((t): t is string => !!t),
  ).size;

  // ── Konu bazında İLK-deneme değerlendirmesi ────────────────────────────────
  const firstByTopic = new Map<string, CertTopicResult>();
  for (const ans of answers) {
    const q = byCode.get(ans.questionCode);
    if (!q || !q.topic) continue;
    if (firstByTopic.has(q.topic)) continue; // yalnızca ilk-deneme
    const opt = q.options.find((o) => o.key === ans.optionKey);
    if (!opt) continue;
    firstByTopic.set(q.topic, {
      topic:      q.topic,
      isRedLine:  q.isRedLine,
      firstScore: opt.competencyScore,
      passed:     isFirstAttemptPass(opt.competencyScore, q.isRedLine),
    });
  }

  const topicResults = [...firstByTopic.values()];
  const passedTopics = topicResults.filter((t) => t.passed).length;
  const passRate     = totalTopics > 0 ? passedTopics / totalTopics : 0;
  const certScore    = Math.round(passRate * 1000) / 10; // 0-100, 1 ondalık
  const passed       = passRate >= PASS_RATE_THRESHOLD;

  const failReason: CertFailReason = passed ? null : 'BELOW_THRESHOLD';
  const newAttempts = membership.certAttempts + 1; // yalnızca kayıt — ceza yok
  const status = passed ? CertificationStatus.CERTIFIED : CertificationStatus.FAILED;

  // ── TenantMembership'e yaz (cooldown YOK — her zaman temizlenir) ────────────
  await prisma.tenantMembership.update({
    where: { userId_tenantId: { userId, tenantId } },
    data: {
      certScore,
      isCertified:         passed,
      certificationStatus: status,
      certifiedAt:         passed ? new Date() : null,
      certAttempts:        newAttempts,
      cooldownUntil:       null,
      ...(passed ? { qualityMultiplier: STARTING_MULTIPLIER } : {}),
    },
  });

  return {
    certScore,
    passRate,
    totalTopics,
    passedTopics,
    passed,
    status,
    qualityMultiplier: passed ? STARTING_MULTIPLIER : membership.qualityMultiplier,
    failReason,
    attempts: newAttempts,
    topicResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Öğrenme akışı için okuma yardımcıları (frontend)
// ─────────────────────────────────────────────────────────────────────────────

export interface CertQuestionPublic {
  code: string;
  topic: string | null;
  variant: string | null;
  isRedLine: boolean;
  scenario: string;
  options: { key: string; label: string }[];
}

/**
 * Aktif sertifika sorularını öğrenme akışı için döndürür.
 * GÜVENLİK: doğru cevabı sızdırmamak için explanation / outcome / competencyScore
 * DÖNMEZ — bunlar yalnızca bir seçim yapıldıktan sonra revealOption ile verilir.
 */
export async function getCertificationQuestions(): Promise<CertQuestionPublic[]> {
  return prisma.certificationQuestion.findMany({
    where:   { isActive: true },
    orderBy: [{ topic: 'asc' }, { variant: 'asc' }],
    select: {
      code:      true,
      topic:     true,
      variant:   true,
      isRedLine: true,
      scenario:  true,
      options: {
        select:  { key: true, label: true },
        orderBy: { key: 'asc' },
      },
    },
  });
}

export interface OptionReveal {
  outcome: string | null;      // "correct" | "acceptable" | "wrong"
  explanation: string | null;  // öğrenme metni
  isRedLine: boolean;
  firstAttemptPass: boolean;   // bu seçim ilk-denemede o konuyu geçirir mi
}

/**
 * Bir seçimin ardından gösterilecek "neden doğru/yanlış" açıklamasını döndürür.
 * Öğrenme anı — seçim yapıldıktan sonra çağrılır.
 */
export async function revealOption(questionCode: string, optionKey: string): Promise<OptionReveal> {
  const q = await prisma.certificationQuestion.findFirst({
    where:  { code: questionCode, isActive: true },
    select: {
      isRedLine: true,
      options: {
        where:  { key: optionKey },
        select: { competencyScore: true, explanation: true, outcome: true },
      },
    },
  });
  const opt = q?.options[0];
  if (!q || !opt) {
    throw new Error(`Soru/seçenek bulunamadı: ${questionCode}/${optionKey}`);
  }
  return {
    outcome:          opt.outcome,
    explanation:      opt.explanation,
    isRedLine:        q.isRedLine,
    firstAttemptPass: isFirstAttemptPass(opt.competencyScore, q.isRedLine),
  };
}
