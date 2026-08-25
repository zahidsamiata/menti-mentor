/**
 * Adaptif Karar Ağacı Test Motoru (Sprint 5)
 *
 * Compliance Note: Bu servis yalnızca Analytical veri döndürür.
 * Ham UserResponse verileri (question+value çiftleri) PII değildir;
 * ancak türetilen discVector hassas kategori PII'dir ve yalnızca
 * kullanıcının kendi profil kaydında saklanır.
 *
 * Akış:
 *   1. CORE sorular tamamlanana kadar sıralı devam edilir.
 *   2. Minimum CORE yanıt sayısına (MIN_CORE_RESPONSES = 5) ulaşılınca
 *      dominant DISC boyutu hesaplanır.
 *   3. Dominant boyuta ait DEEPENING soruları açılır.
 *   4. Tüm sorular tamamlandığında DISC vektörü hesaplanıp kaydedilir.
 */

import { prisma } from '../db.js';
import type { DiscDimension, DiscType } from '@prisma/client';
import type { DiscVector } from './scoring.js';

// Minimum yanıt sayısı — bu eşiğin altında DISC vektörü hesaplanmaz
const MIN_CORE_RESPONSES = 5;

// Boyut bazında DISC katkı ağırlıkları (Likert 1-5 → normalize)
const LIKERT_TO_WEIGHT: Record<number, number> = {
  1: 0.0, 2: 0.25, 3: 0.50, 4: 0.75, 5: 1.0,
};

// ─── Tip tanımları ─────────────────────────────────────────────────────────────

export type QuestionNode = {
  id: string;
  text: string;
  discDimension: DiscDimension;
  order: number;
};

/**
 * Adaptif test ilerleme özeti. Frontend faz geçişini (CORE→DEEPENING→COMPLETE)
 * bu nesneden türetir; istemci tarafı sayım yapmaz.
 * Alanlar frontend `AdaptiveProgress` sözleşmesiyle birebir eşleşir.
 */
export type AdaptiveProgress = {
  /** Toplam yanıtlanmış soru (CORE + DEEPENING) */
  totalAnswered: number;
  /** Yanıtlanmış CORE soru sayısı */
  coreAnswered: number;
  /** Yanıtlanmış (ilgili) DEEPENING soru sayısı */
  deepeningAnswered: number;
  /** DEEPENING fazının açılması için gereken minimum CORE yanıtı */
  coreThreshold: number;
  /** Şu an DEEPENING fazında mı (CORE bitti, test bitmedi) */
  isDeepening: boolean;
  /** Test tamamlandı mı */
  isComplete: boolean;
  /** 0–100 tamamlanma yüzdesi */
  completionPercent: number;
};

export type NextQuestionResult =
  | { done: false; question: QuestionNode; progress: AdaptiveProgress }
  | { done: true; discVector: DiscVector; dominantType: DiscType; progress: AdaptiveProgress };

type ResponseHistory = Array<{ questionId: string; value: number; discDimension: DiscDimension }>;

// ─── Yardımcı: dominant boyut ────────────────────────────────────────────────

function computeRawScores(history: ResponseHistory): Record<string, number> {
  const scores: Record<string, number> = { D: 0, I: 0, S: 0, C: 0 };
  const counts: Record<string, number> = { D: 0, I: 0, S: 0, C: 0 };

  for (const r of history) {
    if (r.discDimension === 'GENERAL') continue;
    scores[r.discDimension] += LIKERT_TO_WEIGHT[r.value] ?? 0.5;
    counts[r.discDimension]++;
  }

  // Ortalama: cevap verilmemiş boyutlar 0.5 (nötr) alır
  for (const dim of ['D', 'I', 'S', 'C'] as const) {
    scores[dim] = counts[dim] > 0 ? scores[dim] / counts[dim] : 0.5;
  }

  return scores;
}

function normalizeToVector(raw: Record<string, number>, confidence: number): DiscVector {
  const total = raw['D'] + raw['I'] + raw['S'] + raw['C'];
  if (total === 0) {
    return { D: 0.25, I: 0.25, S: 0.25, C: 0.25, confidence };
  }
  return {
    D: Math.round((raw['D'] / total) * 1000) / 1000,
    I: Math.round((raw['I'] / total) * 1000) / 1000,
    S: Math.round((raw['S'] / total) * 1000) / 1000,
    C: Math.round((raw['C'] / total) * 1000) / 1000,
    confidence,
  };
}

function getDominantType(raw: Record<string, number>): DiscType {
  const entries = Object.entries(raw) as Array<[DiscType, number]>;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

// ─── Yardımcı: ilerleme özeti (saf) ──────────────────────────────────────────

/**
 * Adaptif test ilerleme özetini saf (DB'siz) hesaplar.
 *
 * @param coreAnswered     Yanıtlanmış CORE soru sayısı
 * @param coreTotal        Toplam aktif CORE soru sayısı
 * @param deepeningAnswered Yanıtlanmış (ilgili) DEEPENING soru sayısı
 * @param deepeningTotal   Bu kullanıcıya açık DEEPENING soru sayısı (dominant boyut bilinmiyorsa 0)
 * @param isComplete       Test tamamlandı mı
 */
export function computeProgress(
  coreAnswered: number,
  coreTotal: number,
  deepeningAnswered: number,
  deepeningTotal: number,
  isComplete: boolean,
): AdaptiveProgress {
  const totalAnswered = coreAnswered + deepeningAnswered;
  const maxPossible = Math.max(coreTotal + deepeningTotal, 1);
  const completionPercent = isComplete
    ? 100
    : Math.min(100, Math.round((totalAnswered / maxPossible) * 100));
  // DEEPENING fazı: CORE eşiği geçildi ve test henüz bitmedi.
  const isDeepening = !isComplete && coreAnswered >= MIN_CORE_RESPONSES;

  return {
    totalAnswered,
    coreAnswered,
    deepeningAnswered,
    coreThreshold: MIN_CORE_RESPONSES,
    isDeepening,
    isComplete,
    completionPercent,
  };
}

// ─── Ana motor ────────────────────────────────────────────────────────────────

/**
 * Kullanıcının mevcut yanıt geçmişine göre bir sonraki soruyu döndürür.
 * Tüm sorular tamamlandıysa hesaplanan DISC vektörünü döndürür.
 */
export async function getNextQuestion(
  userId: string,
  tenantId: string,
): Promise<NextQuestionResult> {
  // Yanıtlanmış sorular
  const responses = await prisma.userResponse.findMany({
    where: { userId },
    select: { questionId: true, value: true },
  });
  const answeredIds = new Set(responses.map((r) => r.questionId));

  // Tüm aktif sorular (CORE önce)
  const allQuestions = await prisma.question.findMany({
    where: {
      isActive: true,
      OR: [{ tenantId }, { tenantId: null }],
    },
    select: { id: true, text: true, discDimension: true, type: true, order: true },
    orderBy: [{ type: 'asc' }, { order: 'asc' }],
  });

  const coreQuestions = allQuestions.filter((q) => q.type === 'CORE');
  const deepeningQuestions = allQuestions.filter((q) => q.type === 'DEEPENING');

  const coreAnsweredCount = coreQuestions.filter((q) => answeredIds.has(q.id)).length;

  // Yanıtsız CORE sorular
  const unansweredCore = coreQuestions.filter((q) => !answeredIds.has(q.id));

  if (unansweredCore.length > 0) {
    // CORE fazı: dominant boyut henüz bilinmiyor → deepeningTotal=0 (yüzde CORE üzerinden).
    const next = unansweredCore[0];
    return {
      done: false,
      question: { id: next.id, text: next.text, discDimension: next.discDimension, order: next.order },
      progress: computeProgress(coreAnsweredCount, coreQuestions.length, 0, 0, false),
    };
  }

  // CORE tamamlandı — yanıt geçmişini oluştur (DISC boyutlarıyla)
  const answeredQuestions = allQuestions.filter((q) => answeredIds.has(q.id));
  const history: ResponseHistory = responses.map((r) => {
    const q = answeredQuestions.find((aq) => aq.id === r.questionId);
    return { questionId: r.questionId, value: r.value, discDimension: q?.discDimension ?? 'GENERAL' };
  });

  if (coreAnsweredCount < MIN_CORE_RESPONSES) {
    // Henüz minimum CORE yanıt sayısına ulaşılmadı
    return {
      done: false,
      question: { id: 'PLACEHOLDER', text: 'Lütfen temel soruları tamamlayın.', discDimension: 'GENERAL', order: 0 },
      progress: computeProgress(coreAnsweredCount, coreQuestions.length, 0, 0, false),
    };
  }

  // Dominant boyutu hesapla → DEEPENING sorularını aç
  const rawScores = computeRawScores(history);
  const dominant = getDominantType(rawScores);

  const relevantDeepening = deepeningQuestions.filter(
    (q) => q.discDimension === dominant || q.discDimension === 'GENERAL',
  );
  const unansweredDeepening = relevantDeepening.filter((q) => !answeredIds.has(q.id));
  const deepeningAnsweredCount = relevantDeepening.length - unansweredDeepening.length;

  if (unansweredDeepening.length > 0) {
    const next = unansweredDeepening[0];
    return {
      done: false,
      question: { id: next.id, text: next.text, discDimension: next.discDimension, order: next.order },
      progress: computeProgress(
        coreAnsweredCount,
        coreQuestions.length,
        deepeningAnsweredCount,
        relevantDeepening.length,
        false,
      ),
    };
  }

  // Tüm sorular tamamlandı — DISC vektörü hesapla ve kaydet
  const totalResponses = history.length;
  const maxPossible = coreQuestions.length + relevantDeepening.length;
  const confidence = Math.min(1, Math.round((totalResponses / Math.max(maxPossible, 1)) * 100) / 100);

  const discVector = normalizeToVector(rawScores, confidence);
  const dominantType = getDominantType(rawScores);

  // Profili güncelle (yalnızca vektör ve tip — PII alanlarına dokunulmaz)
  await prisma.user.update({
    where: { id: userId },
    data: {
      discVector: discVector as object,
      discType: dominantType,
    },
  });

  return {
    done: true,
    discVector,
    dominantType,
    progress: computeProgress(
      coreAnsweredCount,
      coreQuestions.length,
      deepeningAnsweredCount,
      relevantDeepening.length,
      true,
    ),
  };
}

/**
 * Kullanıcının mevcut yanıtlarından DISC vektörü hesaplar (profil güncellemeksizin).
 * Analytics ve ara rapor amaçlıdır.
 * Compliance Note: Dönen veri Analytical — PII alanı içermez.
 */
export async function previewDiscVector(userId: string): Promise<DiscVector> {
  const responses = await prisma.userResponse.findMany({
    where: { userId },
    select: { questionId: true, value: true },
  });

  const questionIds = responses.map((r) => r.questionId);
  const questions = await prisma.question.findMany({
    where: { id: { in: questionIds } },
    select: { id: true, discDimension: true },
  });

  const history: ResponseHistory = responses.map((r) => {
    const q = questions.find((aq) => aq.id === r.questionId);
    return { questionId: r.questionId, value: r.value, discDimension: q?.discDimension ?? 'GENERAL' };
  });

  const rawScores = computeRawScores(history);
  const confidence = Math.min(1, history.length / 20);
  return normalizeToVector(rawScores, confidence);
}
