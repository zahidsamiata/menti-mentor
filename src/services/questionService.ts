/**
 * Soru havuzu ve adaptif akış iş mantığı.
 *
 * Bu servis üç temel soruyu yanıtlar:
 *   1. Kullanıcı hangi soruları görmeli?          → buildQuestionList()
 *   2. Kullanıcının adaptif ilerleme durumu nedir? → calcAdaptiveProgress()
 *   3. Tek bir yanıt nasıl kaydedilir?             → upsertSingleResponse()
 *
 * ──────────────────────────────────────────────────────────────
 * Adaptif Geçiş Modeli
 * ──────────────────────────────────────────────────────────────
 *   CORE sorular: psikometrik temel (boyut başına 5 soru × 4 boyut = 20)
 *   DEEPENING sorular: güven arttırıcı (boyut başına 3 soru × 4 boyut = 12)
 *
 *   DEEPENING'e geçiş koşulu:
 *     coreAnswered >= coreThreshold
 *     coreThreshold = havuzdaki toplam aktif CORE soru sayısı
 *
 *   Bu kural admin-proof'tur: Admin CORE soru eklerse/silerse
 *   threshold otomatik güncellenir; hardcode sabite gerek kalmaz.
 *
 * ──────────────────────────────────────────────────────────────
 * DISC Vektör Güven Skoru
 * ──────────────────────────────────────────────────────────────
 *   confidence = cevaplanmış boyutsal soru sayısı / toplam aktif boyutsal soru sayısı
 *   (GENERAL boyutlu sorular vektöre katkı sağlamaz; confidence'a dahil edilmez)
 *   Tüm boyutsal sorular cevaplanınca confidence = 1.0
 */

import { prisma } from '../db.js';

// ─── Dışa aktarılan tipler ───────────────────────────────────────────────────

/**
 * Tenant'a erişilebilir aktif soru listesi meta verisi.
 * Değerler her zaman DB'den hesaplanır; sabit sayılara bağımlılık yoktur.
 */
export interface QuestionPoolMeta {
  coreCount: number;
  deepeningCount: number;
  /** DEEPENING açılması için cevaplandırılması gereken CORE soru sayısı (= coreCount) */
  coreThreshold: number;
  /** discVector confidence skoru için temel (GENERAL hariç aktif soru sayısı) */
  dimensionalTotal: number;
}

/**
 * Kullanıcının anlık adaptif ilerleme durumu.
 * Hook ve controller bu nesneyi kullanarak faz kararı verir.
 */
export interface AdaptiveProgress {
  totalAnswered: number;
  coreAnswered: number;
  deepeningAnswered: number;
  /** DEEPENING kilidinin açıldığı eşik */
  coreThreshold: number;
  /** Kullanıcı tüm CORE'ları cevaplayıp DEEPENING aşamasına geçti mi */
  isDeepening: boolean;
  /** Tüm havuz (CORE + DEEPENING) tamamlandı mı */
  isComplete: boolean;
  /** 0–100 tamamlanma yüzdesi */
  completionPercent: number;
}

// ─── Soru listesi ─────────────────────────────────────────────────────────────

/**
 * Tenant'a erişilebilir (global + tenant-özel) aktif soruları getirir.
 * Sıralama: CORE önce, her grup içinde `order` alanına göre artan.
 * Bu sıralama frontend'de yeniden sıralamaya gerek bırakmaz.
 */
export async function buildQuestionList(tenantId: string) {
  // Bu tenant tarafından gizlenmiş global soru ID'leri
  const hiddenIds = await (prisma as unknown as {
    questionHide: { findMany: (a: unknown) => Promise<Array<{ questionId: string }>> };
  }).questionHide.findMany({
    where:  { tenantId },
    select: { questionId: true },
  });
  const hiddenSet = new Set(hiddenIds.map((h) => h.questionId));

  const allQuestions = await prisma.question.findMany({
    where: {
      isActive: true,
      OR: [{ tenantId: null }, { tenantId }],
    },
    orderBy: [{ type: 'asc' }, { order: 'asc' }],
    select: { id: true, text: true, type: true, discDimension: true, order: true, category: true },
  });

  // Gizlenmiş soruları listeden çıkar
  const visible = allQuestions.filter((q) => !hiddenSet.has(q.id));

  // DISC skoruna katkı sağlayan sorular vs STK özel soruları (DISC'e katılmaz)
  const questions    = visible.filter((q) => (q.category as string | null) !== 'STK_CUSTOM');
  const stkQuestions = visible.filter((q) => (q.category as string | null) === 'STK_CUSTOM');

  const meta = calcPoolMeta(questions);
  return { questions, stkQuestions, meta };
}

/**
 * Soru listesinden pool meta verisini türetir.
 * Ayrı bir DB sorgusu gerektirmez; mevcut liste üzerinden hesaplanır.
 */
export function calcPoolMeta(
  questions: { type: string; discDimension: string }[],
): QuestionPoolMeta {
  const coreCount = questions.filter((q) => q.type === 'CORE').length;
  const deepeningCount = questions.filter((q) => q.type === 'DEEPENING').length;
  // GENERAL boyutlu sorular vektöre katkı sağlamaz; confidence hedefinden çıkar
  const dimensionalTotal = questions.filter((q) => q.discDimension !== 'GENERAL').length;

  return {
    coreCount,
    deepeningCount,
    coreThreshold: coreCount, // tüm CORE sorular cevaplanınca DEEPENING açılır
    dimensionalTotal,
  };
}

// ─── Adaptif ilerleme ────────────────────────────────────────────────────────

/**
 * Kullanıcının cevaplanmış sorularını ve faz durumunu hesaplar.
 * Tek DB sorgusuyla hem yanıt sayısını hem havuz büyüklüğünü alır.
 */
export async function calcAdaptiveProgress(
  userId: string,
  tenantId: string,
): Promise<AdaptiveProgress> {
  const [{ questions, meta }, userResponses] = await Promise.all([
    buildQuestionList(tenantId),
    prisma.userResponse.findMany({
      where: { userId },
      select: { questionId: true },
    }),
  ]);

  const answeredSet = new Set(userResponses.map((r) => r.questionId));
  // Yalnızca havuzdaki sorulara verilen yanıtları say
  const poolIds = new Set(questions.map((q) => q.id));
  const poolAnsweredIds = [...answeredSet].filter((id) => poolIds.has(id));

  // Boyut bazlı cevap sayıları için O(1) lookup haritası
  const questionTypeMap = new Map(questions.map((q) => [q.id, q.type]));

  let coreAnswered = 0;
  let deepeningAnswered = 0;
  for (const id of poolAnsweredIds) {
    const type = questionTypeMap.get(id);
    if (type === 'CORE') coreAnswered++;
    else if (type === 'DEEPENING') deepeningAnswered++;
  }

  const totalAnswered = coreAnswered + deepeningAnswered;
  const totalInPool = meta.coreCount + meta.deepeningCount;

  /**
   * isDeepening — Tek yönlü ilerleme (monotonic) kuralı:
   *
   * Sorun: Admin yeni CORE sorular eklediğinde coreThreshold artar.
   * Eski kural (coreAnswered >= coreThreshold) bunu regresyon yapar:
   *   - Kullanıcı 20/20 CORE cevapladı → isDeepening: true ✅
   *   - Admin 5 CORE ekledi → threshold 25 oldu
   *   - 20 < 25 → isDeepening: false ❌ (kullanıcı CORE'a geri düşer!)
   *
   * Düzeltme:
   *   1. Eğer kullanıcı herhangi bir DEEPENING sorusu cevapladıysa zaten DEEPENING'dedir.
   *      Bu durum geri alınamaz — admin ne kadar soru eklerse eklesin.
   *   2. CORE eşiği yalnızca yeni kullanıcılar için referans alınır.
   */
  const isDeepening = coreAnswered >= meta.coreThreshold || deepeningAnswered > 0;
  const isComplete = totalAnswered >= totalInPool && totalInPool > 0;
  const completionPercent = totalInPool > 0
    ? Math.round((totalAnswered / totalInPool) * 100)
    : 0;

  return {
    totalAnswered,
    coreAnswered,
    deepeningAnswered,
    coreThreshold: meta.coreThreshold,
    isDeepening,
    isComplete,
    completionPercent,
  };
}

// ─── Tek soru yanıtı ─────────────────────────────────────────────────────────

/**
 * Kullanıcının tek bir soruya verdiği yanıtı kaydeder veya günceller.
 * İdempotent: aynı soru için tekrar çağrılırsa değeri günceller.
 *
 * @returns Kaydedilen yanıt nesnesi
 */
export async function upsertSingleResponse(
  userId: string,
  questionId: string,
  value: number,
) {
  return prisma.userResponse.upsert({
    where: { userId_questionId: { userId, questionId } },
    create: { userId, questionId, value },
    update: { value },
  });
}

/**
 * Soru ID'lerinin bu tenant'a erişilebilir ve aktif olup olmadığını doğrular.
 * @returns Geçersiz ID'lerin listesi (boşsa tüm ID'ler geçerlidir)
 */
export async function validateQuestionIds(
  questionIds: string[],
  tenantId: string,
): Promise<string[]> {
  if (questionIds.length === 0) return [];

  const valid = await prisma.question.findMany({
    where: {
      id: { in: questionIds },
      isActive: true,
      OR: [{ tenantId: null }, { tenantId }],
    },
    select: { id: true },
  });
  const validSet = new Set(valid.map((q) => q.id));
  return questionIds.filter((id) => !validSet.has(id));
}
