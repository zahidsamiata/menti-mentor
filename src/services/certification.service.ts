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
//
// İki farklı "tekrar" seviyesi (karıştırma):
//   - Konu içi (tek sınav oturumunda): yanlışta ceza YOK — UI aynı konunun farklı
//     varyantını sunar (öğret, eleme). İlk-deneme sonucu değişmez.
//   - Sınav seviyesi (deneme döngüsü): 2 sınav hakkı; 2.de kalınırsa 24s bekleme;
//     sonraki denemede yanlış konulara ağırlık verilir.
//
// Tüm sertifika durumu TenantMembership'te saklanır (per-tenant).
// ─────────────────────────────────────────────────────────────────────────────

// ── Tek kaynak yapılandırma — motor, panel, deneme döngüsü ve hatırlatma bunu kullanır ──
export const CERT_CONFIG = {
  /** Aktif konuların en az bu oranı ilk-denemede geçmeli (yukarı yuvarlanır). */
  passRateThreshold: 0.8,
  /** Kurum, toplam aktif konu sayısını bu değerin altına düşüremez. */
  minActiveTopics: 5,
  /** Kaç başarısız sınav denemesinden sonra bekleme başlar. */
  attemptsBeforeCooldown: 2,
  /** Bekleme süresi (saat). */
  cooldownHours: 24,
  /** Sertifika açıldıktan (üyelik oluşumundan) kaç gün sonra hatırlatma başlar. */
  reminderStartDays: 3,
  /** En fazla kaç hatırlatma gönderilir (günde 1) — sonra STK yöneticisine bildirim. */
  reminderMaxCount: 3,
  /** İki hatırlatma arasında en az bu kadar saat geçmeli (günde 1 koruması). */
  reminderMinHoursBetween: 20,
} as const;

// Geriye dönük uyum (eski import'lar için).
export const PASS_RATE_THRESHOLD = CERT_CONFIG.passRateThreshold;

const STARTING_MULTIPLIER = 1.0;  // sertifika alınınca kalite çarpanı sıfırlanır

/**
 * Verilen AKTİF konu sayısı için ilk-denemede geçilmesi gereken minimum konu sayısı.
 * Payda ASLA sabit 10 değil — kurumda AÇIK olan konu sayısıdır. Küsurat YUKARI yuvarlanır.
 * Örn. 4 konu × 0.8 = 3.2 → 4;  7 × 0.8 = 5.6 → 6;  5 × 0.8 = 4 → 4.
 */
export function requiredToPass(activeTopicCount: number): number {
  return Math.ceil(activeTopicCount * CERT_CONFIG.passRateThreshold);
}

/** Konu aç/kapat kısıt hatası — controller HTTP durumuna map'ler. */
export class CertTopicError extends Error {
  constructor(
    public code: 'UNKNOWN_TOPIC' | 'RED_LINE_LOCKED' | 'MIN_TOPICS' | 'TENANT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'CertTopicError';
  }
}

/** Bir seçeneğin ilk-denemede "geçer" olup olmadığı (konunun kritikliğine göre). */
export function isFirstAttemptPass(competencyScore: number, isRedLine: boolean): boolean {
  return isRedLine ? competencyScore === 3 : competencyScore >= 2;
}

/** Kurumun kapattığı sertifika konusu slug'ları (per-tenant). Boş = tüm konular aktif. */
async function getDisabledTopics(tenantId: string): Promise<Set<string>> {
  const t = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { disabledCertTopics: true },
  });
  return new Set(t?.disabledCertTopics ?? []);
}

export interface CertAnswer {
  questionCode: string;
  optionKey: string;
}

export type CertFailReason =
  | 'BELOW_THRESHOLD'   // aktif konuların %80'i geçilemedi
  | 'RED_LINE_FAILED'   // en az bir açık red-line konu ilk-denemede 3 ile geçilemedi
  | 'NO_ACTIVE_TOPICS'  // kurumda açık konu yok (değerlendirilemez)
  | 'COOLDOWN_ACTIVE'   // bekleme süresi dolmadan yeni deneme yapılamaz
  | null;

export interface CertTopicResult {
  topic: string;
  isRedLine: boolean;
  firstScore: number;
  passed: boolean;
}

export interface CertResult {
  certScore: number;        // ilk-deneme geçme oranı (0-100)
  passRate: number;         // 0-1
  totalTopics: number;      // aktif (açık) konu sayısı = oransal eşik paydası
  passedTopics: number;
  required: number;         // geçmek için gereken minimum konu (ceil(total × %80))
  redLineOk: boolean;       // tüm açık red-line konular ilk-denemede geçildi mi
  passed: boolean;
  status: CertificationStatus;
  qualityMultiplier: number;
  failReason: CertFailReason;
  attempts: number;
  cooldownUntil: Date | null; // bekleme süresi bitiş anı (varsa)
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

  // ── Bekleme (cooldown) kapısı: süre dolmadan yeni deneme değerlendirilmez ────
  // (Deneme sayacı artmaz, membership'e yazılmaz — sadece reddedilir.)
  if (membership.cooldownUntil && membership.cooldownUntil.getTime() > Date.now()) {
    return {
      certScore: membership.certScore ?? 0, passRate: 0, totalTopics: 0, passedTopics: 0,
      required: 0, redLineOk: false, passed: false, status: membership.certificationStatus,
      qualityMultiplier: membership.qualityMultiplier, failReason: 'COOLDOWN_ACTIVE',
      attempts: membership.certAttempts, cooldownUntil: membership.cooldownUntil, topicResults: [],
    };
  }

  // Aktif soru havuzu (seçenek puanları + konu/kritiklik).
  const questions = await prisma.certificationQuestion.findMany({
    where:   { isActive: true },
    include: { options: true },
  });
  const byCode = new Map(questions.map((q) => [q.code, q]));

  // Kurumun kapattığı konular değerlendirmeye girmez (per-tenant).
  const disabled = await getDisabledTopics(tenantId);

  // Açık konular + konu-bazında red-line türetimi (bir konunun herhangi bir sorusu
  // red-line ise o konu red-line'dır). Payda = AÇIK konu sayısı (sabit değil).
  const topicRedLine = new Map<string, boolean>();
  for (const q of questions) {
    if (!q.topic || disabled.has(q.topic)) continue;
    topicRedLine.set(q.topic, (topicRedLine.get(q.topic) ?? false) || q.isRedLine);
  }
  const totalTopics = topicRedLine.size;

  // ── Sıfır guard: açık konu yoksa değerlendirilemez (membership'e YAZMA) ──────
  if (totalTopics === 0) {
    return {
      certScore: 0, passRate: 0, totalTopics: 0, passedTopics: 0, required: 0,
      redLineOk: false, passed: false, status: CertificationStatus.FAILED,
      qualityMultiplier: membership.qualityMultiplier, failReason: 'NO_ACTIVE_TOPICS',
      attempts: membership.certAttempts, cooldownUntil: null, topicResults: [],
    };
  }

  // ── Konu bazında İLK-deneme değerlendirmesi (yalnızca açık konular) ─────────
  const firstByTopic = new Map<string, CertTopicResult>();
  for (const ans of answers) {
    const q = byCode.get(ans.questionCode);
    if (!q || !q.topic) continue;
    if (disabled.has(q.topic)) continue;      // kapalı konu sayılmaz
    if (firstByTopic.has(q.topic)) continue;  // yalnızca ilk-deneme
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
  const passRate     = passedTopics / totalTopics;
  const certScore    = Math.round(passRate * 1000) / 10; // 0-100, 1 ondalık

  // Oransal eşik: geçen konu >= ceil(açık konu × %80).
  const required   = requiredToPass(totalTopics);
  const passRateOk = passedTopics >= required;

  // Red-line MUTLAK kapı: her AÇIK red-line konu ilk-denemede geçilmiş olmalı (oran değil).
  const openRedLineTopics = [...topicRedLine.entries()].filter(([, rl]) => rl).map(([t]) => t);
  const redLineOk = openRedLineTopics.every((t) => firstByTopic.get(t)?.passed === true);

  const passed = passRateOk && redLineOk;
  // Red-line ihlali önceliklidir (mutlak kapı), sonra oransal eşik.
  const failReason: CertFailReason = passed
    ? null
    : !redLineOk
      ? 'RED_LINE_FAILED'
      : 'BELOW_THRESHOLD';
  const newAttempts = membership.certAttempts + 1;
  const status = passed ? CertificationStatus.CERTIFIED : CertificationStatus.FAILED;

  // ── Sınav-seviyesi deneme döngüsü (konu-içi öğrenme akışından AYRI) ──────────
  // Her `attemptsBeforeCooldown` başarısız denemede bir bekleme süresi başlar.
  const cooldownTriggered =
    !passed && newAttempts % CERT_CONFIG.attemptsBeforeCooldown === 0;
  const cooldownUntil = cooldownTriggered
    ? new Date(Date.now() + CERT_CONFIG.cooldownHours * 60 * 60 * 1000)
    : null;

  // Sonraki denemede ağırlıklandırmak için bu denemede geçilemeyen konular.
  // Geçince temizlenir; başarısızsa güncel yanlış liste yazılır.
  const wrongTopics = passed ? [] : topicResults.filter((t) => !t.passed).map((t) => t.topic);

  await prisma.tenantMembership.update({
    where: { userId_tenantId: { userId, tenantId } },
    data: {
      certScore,
      isCertified:         passed,
      certificationStatus: status,
      certifiedAt:         passed ? new Date() : null,
      certAttempts:        newAttempts,
      cooldownUntil,
      certWrongTopics:     wrongTopics,
      ...(passed ? { qualityMultiplier: STARTING_MULTIPLIER } : {}),
    },
  });

  return {
    certScore,
    passRate,
    totalTopics,
    passedTopics,
    required,
    redLineOk,
    passed,
    status,
    qualityMultiplier: passed ? STARTING_MULTIPLIER : membership.qualityMultiplier,
    failReason,
    attempts: newAttempts,
    cooldownUntil,
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
 * Aktif sertifika sorularını öğrenme akışı için döndürür (kurumun kapattığı konular hariç).
 * GÜVENLİK: doğru cevabı sızdırmamak için explanation / outcome / competencyScore
 * DÖNMEZ — bunlar yalnızca bir seçim yapıldıktan sonra revealOption ile verilir.
 *
 * @param priorityTopics Önceki denemede geçilemeyen konular. Verilirse bu konular
 *   listenin BAŞINA alınır (ağırlıklı tekrar) — mentör önce zayıf olduğu konulara odaklanır.
 */
export async function getCertificationQuestions(
  tenantId: string,
  priorityTopics: string[] = [],
): Promise<CertQuestionPublic[]> {
  const disabled = await getDisabledTopics(tenantId);
  const questions = await prisma.certificationQuestion.findMany({
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
  const active = questions.filter((q) => !q.topic || !disabled.has(q.topic));

  if (priorityTopics.length === 0) return active;

  // Ağırlıklı tekrar: yanlış konular başa (stabil — konu-içi mevcut sıra korunur).
  const priority = new Set(priorityTopics);
  const weight = (q: CertQuestionPublic) => (q.topic && priority.has(q.topic) ? 0 : 1);
  return [...active].sort((a, b) => weight(a) - weight(b));
}

// ─────────────────────────────────────────────────────────────────────────────
// STK admin: konu aç/kapat (kurum senaryo ekleyemez/düzenleyemez, sadece seçer)
// ─────────────────────────────────────────────────────────────────────────────

export interface CertTopicInfo {
  topic: string;
  isRedLine: boolean;
  variantCount: number;
  enabled: boolean;
  locked: boolean;   // red-line → kapatılamaz (UI kilitli gösterir, backend reddeder)
}

/** Kurumun sertifika konularını (aç/kapat + kilit durumuyla) listeler. */
export async function listCertificationTopics(tenantId: string): Promise<CertTopicInfo[]> {
  const disabled = await getDisabledTopics(tenantId);
  const qs = await prisma.certificationQuestion.findMany({
    where:  { isActive: true },
    select: { topic: true, isRedLine: true },
  });
  const map = new Map<string, { isRedLine: boolean; count: number }>();
  for (const q of qs) {
    if (!q.topic) continue;
    const e = map.get(q.topic) ?? { isRedLine: false, count: 0 };
    e.count += 1;
    e.isRedLine = e.isRedLine || q.isRedLine;
    map.set(q.topic, e);
  }
  return [...map.entries()]
    .map(([topic, e]) => ({
      topic,
      isRedLine: e.isRedLine,
      variantCount: e.count,
      enabled: !disabled.has(topic),
      locked: e.isRedLine,          // red-line konular kilitli (kapatılamaz)
    }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

export interface TopicsOverview {
  topics: CertTopicInfo[];
  activeCount: number;      // o an açık konu sayısı
  requiredToPass: number;   // sertifika için geçilmesi gereken konu (ceil(activeCount × %80))
  minActiveTopics: number;  // izin verilen en düşük açık konu sayısı
  threshold: number;        // oransal eşik (0-1)
}

/** Panel için tek kaynak özet — UI kendi başına eşik HESAPLAMAZ, bunu gösterir. */
export async function getTopicsOverview(tenantId: string): Promise<TopicsOverview> {
  const topics = await listCertificationTopics(tenantId);
  const activeCount = topics.filter((t) => t.enabled).length;
  return {
    topics,
    activeCount,
    requiredToPass: requiredToPass(activeCount),
    minActiveTopics: CERT_CONFIG.minActiveTopics,
    threshold: CERT_CONFIG.passRateThreshold,
  };
}

/**
 * Bir konuyu kurum için açar/kapatır. Yalnızca MEVCUT (aktif) konular hedeflenebilir —
 * kurum yeni konu/senaryo ekleyemez, yalnızca var olanı seçer/kaldırır.
 *
 * Korumalar (backend son sözü söyler — frontend yalnızca görsel):
 *   - Red-line konu KAPATILAMAZ (RED_LINE_LOCKED).
 *   - Toplam açık konu CERT_CONFIG.minActiveTopics altına düşürülemez (MIN_TOPICS).
 */
export async function setCertificationTopic(
  tenantId: string,
  topic: string,
  enabled: boolean,
): Promise<CertTopicInfo[]> {
  const topicQuestions = await prisma.certificationQuestion.findMany({
    where:  { isActive: true, topic },
    select: { isRedLine: true },
  });
  if (topicQuestions.length === 0) {
    throw new CertTopicError('UNKNOWN_TOPIC', `Bilinmeyen sertifika konusu: ${topic}`);
  }
  const isRedLineTopic = topicQuestions.some((q) => q.isRedLine);

  const t = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { disabledCertTopics: true },
  });
  if (!t) throw new CertTopicError('TENANT_NOT_FOUND', `Tenant bulunamadı: ${tenantId}`);

  if (!enabled) {
    // Red-line kapatılamaz.
    if (isRedLineTopic) {
      throw new CertTopicError('RED_LINE_LOCKED', 'Kritik (red-line) konular kapatılamaz.');
    }
    // Min konu sınırı: yalnızca hâlihazırda AÇIK bir konuyu kapatırken kontrol et.
    const current = await listCertificationTopics(tenantId);
    const activeCount = current.filter((c) => c.enabled).length;
    const isCurrentlyOpen = current.find((c) => c.topic === topic)?.enabled ?? false;
    if (isCurrentlyOpen && activeCount - 1 < CERT_CONFIG.minActiveTopics) {
      throw new CertTopicError(
        'MIN_TOPICS',
        `En az ${CERT_CONFIG.minActiveTopics} konu açık kalmalı.`,
      );
    }
  }

  const set = new Set(t.disabledCertTopics);
  if (enabled) set.delete(topic);
  else set.add(topic);

  await prisma.tenant.update({
    where: { id: tenantId },
    data:  { disabledCertTopics: [...set] },
  });
  return listCertificationTopics(tenantId);
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
