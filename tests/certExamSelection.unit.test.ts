/**
 * Sertifika sınavı SEÇİM kuralları (saf fonksiyon, DB yok).
 *
 * - madde 149 (I-04): açık her kritik konu sınavda yer alır — havuz büyüse, sıra değişse,
 *   örnekleme açılsa bile.
 * - madde 157 (I-07): önceki denemede yanlış yapılan konu MUTLAKA gelir, başa alınır ve
 *   tekrar denemede diğer varyantıyla (farklı sahne) başlar.
 * - İlk kez girende (deneme verisi yok) davranış eskisiyle aynıdır.
 */

import { describe, it, expect } from 'vitest';
import { selectExamQuestions, type ExamQuestion } from '../src/services/certExamSelection.js';

const RED_LINE = ['yapici-geri-bildirim', 'sinir-koyma', 'gizlilik-guven', 'kriz-yonetimi'];

function q(topic: string, variant: string, isRedLine = false): ExamQuestion {
  return { code: `${topic}_${variant}`, topic, variant, isRedLine };
}

/** topic asc, variant asc — DB'nin döndürdüğü sırayla aynı. */
function pool(normalTopicCount: number, variants = ['A', 'B']): ExamQuestion[] {
  const topics = [
    ...RED_LINE.map((t) => ({ t, rl: true })),
    ...Array.from({ length: normalTopicCount }, (_, i) => ({ t: `normal-${String(i).padStart(2, '0')}`, rl: false })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  return topics.flatMap(({ t, rl }) => variants.map((v) => q(t, v, rl)));
}

const topicsOf = (qs: ExamQuestion[]) => [...new Set(qs.map((x) => x.topic))];
/** Her konunun ilk gösterilen (puanlanan) varyantı. */
const firstVariantByTopic = (qs: ExamQuestion[]) => {
  const m = new Map<string, string | null>();
  for (const x of qs) if (x.topic && !m.has(x.topic)) m.set(x.topic, x.variant);
  return m;
};

// Deterministik rastgele (mulberry32) — test tekrarlanabilir olsun.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('I-04 · kritik konu garantisi (madde 149)', () => {
  it('varsayılan: tüm açık konular gelir, 4 kritik konu dahil', () => {
    const out = selectExamQuestions(pool(6));
    expect(topicsOf(out)).toHaveLength(10);
    for (const t of RED_LINE) expect(topicsOf(out)).toContain(t);
  });

  it('havuz büyüyüp örnekleme açılsa da 4 kritik konu HER seferinde seçilir', () => {
    const big = pool(40, ['A', 'B', 'C']);
    for (let seed = 1; seed <= 200; seed++) {
      const out = selectExamQuestions(big, { maxTopics: 8, random: seeded(seed) });
      const topics = topicsOf(out);
      expect(topics).toHaveLength(8);
      for (const t of RED_LINE) expect(topics).toContain(t);
    }
  });

  it('limit kritik konu sayısından küçük olsa bile kritik konu düşmez', () => {
    const out = selectExamQuestions(pool(10), { maxTopics: 2, random: seeded(7) });
    expect(topicsOf(out).sort()).toEqual([...RED_LINE].sort());
  });

  it('girdi sırası karışık gelse de kritik konular seçilir ve konu grupları bölünmez', () => {
    const shuffled = [...pool(12)].reverse();
    const out = selectExamQuestions(shuffled, { maxTopics: 6, random: seeded(3) });
    for (const t of RED_LINE) expect(topicsOf(out)).toContain(t);
    // Aynı konunun varyantları ardışık (ekran konu konu ilerler).
    const seen = new Set<string>();
    let prev: string | null = null;
    for (const x of out) {
      if (x.topic !== prev) {
        expect(seen.has(x.topic!)).toBe(false);
        seen.add(x.topic!);
        prev = x.topic;
      }
    }
  });

  it('bir konunun tek varyantı kritikse konu kritik sayılır', () => {
    const mixed = [q('karma', 'A', false), q('karma', 'B', true), ...pool(10)];
    const out = selectExamQuestions(mixed, { maxTopics: 5, random: seeded(11) });
    expect(topicsOf(out)).toContain('karma');
  });
});

describe('I-07 · yanlış yapılan konu tekrar gelir (madde 157)', () => {
  it('ilk kez girende (deneme verisi yok) sıra ve varyant eskisiyle aynı: konu sırası, A önce', () => {
    const input = pool(6);
    const out = selectExamQuestions(input);
    expect(out.map((x) => x.code)).toEqual(input.map((x) => x.code));
    for (const v of firstVariantByTopic(out).values()) expect(v).toBe('A');
  });

  it('yanlış konu listenin başında ve diğer varyantıyla (B) başlıyor', () => {
    const out = selectExamQuestions(pool(6), { priorityTopics: ['normal-03', 'sinir-koyma'], attemptNumber: 1 });
    expect(topicsOf(out).slice(0, 2)).toEqual(['normal-03', 'sinir-koyma']);
    expect(out[0]!.code).toBe('normal-03_B');
    expect(firstVariantByTopic(out).get('sinir-koyma')).toBe('B');
  });

  it('örnekleme açıkken bile yanlış konu MUTLAKA seçilir', () => {
    const big = pool(40);
    for (let seed = 1; seed <= 100; seed++) {
      const out = selectExamQuestions(big, {
        priorityTopics: ['normal-17', 'normal-33'], attemptNumber: 1, maxTopics: 8, random: seeded(seed),
      });
      expect(topicsOf(out).slice(0, 2)).toEqual(['normal-17', 'normal-33']);
    }
  });

  it('art arda denemelerde puanlanan sahne bir önceki denemeninkiyle aynı değil', () => {
    const input = pool(6);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const prev = firstVariantByTopic(selectExamQuestions(input, { attemptNumber: attempt - 1 }));
      const curr = firstVariantByTopic(selectExamQuestions(input, { attemptNumber: attempt }));
      for (const [topic, v] of curr) expect(v).not.toBe(prev.get(topic));
    }
  });

  it('tek varyantlı konu ve konusuz soru bozulmaz; havuzda olmayan öncelik konusu yok sayılır', () => {
    const input = [q('tek', 'A'), { code: 'KONUSUZ', topic: null, variant: null, isRedLine: false }, ...pool(2)];
    const out = selectExamQuestions(input, { priorityTopics: ['silinmis-konu', 'tek'], attemptNumber: 3 });
    expect(out).toHaveLength(input.length);
    expect(out[0]!.code).toBe('tek_A');
    expect(out.map((x) => x.code)).toContain('KONUSUZ');
  });
});
