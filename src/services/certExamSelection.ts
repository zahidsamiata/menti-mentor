// ─────────────────────────────────────────────────────────────────────────────
// Sertifika sınavı SEÇİM kuralları (hangi senaryolar, hangi sırayla gelir).
//
// PUANLAMA burada DEĞİL — o `certification.service.ts` › evaluateCertification'dadır.
// Bu modül saf (DB/HTTP yok) ki kurallar birim testle kilitlenebilsin.
//
// Kurallar (kaynak: faz6-ogrenme-ve-sertifika-2026-09-03.md §5 · madde 149 / 157):
//   1. Kritik (red-line) konu GARANTİ (madde 149): açık her kritik konu sınavda yer alır.
//      Örnekleme (`maxTopics`) açılsa bile kritik konular ASLA düşmez — limit aşılsa da.
//   2. Yanlış yapılan konu MUTLAKA gelir (madde 157): önceki denemede geçilemeyen konular
//      kritik konulardan hemen sonra garantilidir ve listenin BAŞINA alınır.
//   3. Tekrar denemede "sahne değişir" (faz6 §5 "Tekrar denemede ne değişir"): her konunun
//      ilk gösterilen varyantı deneme sayısına göre döner (0.→A, 1.→B, 2.→A…). Böylece bir
//      önceki denemede puanlanan sahne bir sonrakinde ilk sırada GELMEZ (≥2 varyantlı konuda).
//      İlk-deneme puanı yalnız konunun İLK gösterilen varyantından alınır (evaluate kuralı).
//
// ⚠️ `maxTopics` bugün ÇAĞRILMIYOR: puanlama paydası kurumdaki TÜM açık konulardır
// (evaluateCertification › totalTopics). Örnekleme açılırsa geçme eşiği matematiksel
// olarak ulaşılamaz hale gelir → önce puanlama kararı gerekir (faz6 §5 "4 garanti + 4 rastgele").
// Parametre, garantinin havuz büyüdüğünde de bozulmadığını KANITLAMAK için test ediliyor.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExamQuestion {
  code: string;
  topic: string | null;
  variant: string | null;
  isRedLine: boolean;
}

export interface ExamSelectionOptions {
  /** Önceki denemede geçilemeyen konular (TenantMembership.certWrongTopics). */
  priorityTopics?: readonly string[];
  /** Daha önce kaç sınav değerlendirildi (TenantMembership.certAttempts). 0 = ilk sınav. */
  attemptNumber?: number;
  /** Verilirse en fazla bu kadar konu seçilir; kritik + öncelikli konular yine de düşmez. */
  maxTopics?: number;
  /** Örnekleme için rastgele kaynak (test edilebilirlik). */
  random?: () => number;
}

interface TopicGroup<T> {
  key: string;
  isRedLine: boolean;
  variants: T[];
}

function groupByTopic<T extends ExamQuestion>(questions: readonly T[]): TopicGroup<T>[] {
  const order: string[] = [];
  const map = new Map<string, TopicGroup<T>>();
  for (const q of questions) {
    // Konusu olmayan soru kendi başına bir grup (evaluate de konusuz soruyu saymaz).
    const key = q.topic ?? `__code:${q.code}`;
    let g = map.get(key);
    if (!g) {
      g = { key, isRedLine: false, variants: [] };
      map.set(key, g);
      order.push(key);
    }
    // Bir konunun herhangi bir varyantı kritikse konu kritiktir (evaluate ile aynı türetim).
    g.isRedLine = g.isRedLine || q.isRedLine;
    g.variants.push(q);
  }
  return order.map((k) => map.get(k)!);
}

/** Varyantları harf sırasına dizer, sonra deneme sayısı kadar döndürür. */
function rotateVariants<T extends ExamQuestion>(variants: readonly T[], attemptNumber: number): T[] {
  const sorted = [...variants].sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? ''));
  const n = sorted.length;
  if (n < 2) return sorted;
  const shift = ((attemptNumber % n) + n) % n;
  return [...sorted.slice(shift), ...sorted.slice(0, shift)];
}

function sampleWithoutReplacement<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(0, count));
}

/**
 * Sınavda gösterilecek soruları seçer ve sıralar. Girdi: kurumda AÇIK olan aktif sorular.
 * Çıktı: konu grupları ardışık (önce öncelikli/yanlış konular), her konu içinde ilk eleman
 * o denemede puanlanacak varyanttır.
 */
export function selectExamQuestions<T extends ExamQuestion>(
  questions: readonly T[],
  options: ExamSelectionOptions = {},
): T[] {
  const priority = new Set(options.priorityTopics ?? []);
  const attemptNumber = Math.max(0, Math.floor(options.attemptNumber ?? 0));
  const groups = groupByTopic(questions);

  // Sıra: yanlış yapılan konular başa (stabil — kalan sıra korunur).
  const isPriority = (g: TopicGroup<T>) => priority.has(g.key);
  const ordered = [...groups.filter(isPriority), ...groups.filter((g) => !isPriority(g))];

  let chosen = ordered;
  const { maxTopics } = options;
  if (maxTopics !== undefined && maxTopics < ordered.length) {
    const guaranteed = ordered.filter((g) => g.isRedLine || isPriority(g));
    const rest = ordered.filter((g) => !g.isRedLine && !isPriority(g));
    const fill = sampleWithoutReplacement(rest, maxTopics - guaranteed.length, options.random ?? Math.random);
    const keep = new Set([...guaranteed, ...fill].map((g) => g.key));
    chosen = ordered.filter((g) => keep.has(g.key));
  }

  return chosen.flatMap((g) => rotateVariants(g.variants, attemptNumber));
}
