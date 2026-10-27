/**
 * AJ-111 (md.111 / G2-06) — eşleştirme gevşetme oranı.
 *
 * `rankMentisForMentor` (matching.ts) her istekte bir `fallbackLevel` üretir:
 *   0 tüm filtreler · 1 zaman filtresi gevşedi · 2 anti-match kalktı · 3 yalnız sektör uyumu.
 * Bu değer eskiden yalnız o isteğin yanıtında dönüyordu; kurum genelinde "kaç istek gevşetilmiş
 * kurallarla sonuçlandı" bilinmiyordu. Bu servis istek başına kurum + gün + kademe SAYACINI artırır
 * ve platform kurum analizine son 30 günün oranını verir.
 *
 * TASARIM — neden kişi düzeyinde kayıt YOK: tabloda yalnız (tenantId, day, level, count) var;
 * mentör/menti kimliği tutulmaz. Toplu sayaç kişisel veri değildir → yeni bir KVKK işleme amacı,
 * saklama süresi ya da silme yükümlülüğü doğurmaz (k-anonimlik maskesi de gerekmez).
 *
 * SAKLAMA — süresiz: satır sayısı kurum başına en fazla 4/gün (~1.460/yıl) ile sınırlıdır ve
 * kişisel veri içermez; SystemLog'un 90 günlük temizliği (gdprService) kişisel veri içeren log
 * içindir, buraya uygulanmaz. Kurum silinirse FK ON DELETE CASCADE sayaçları da siler.
 *
 * GÜN — İstanbul takvim günü: ürünün kullanıcıları Türkiye'de; "bugün" kurum yöneticisinin
 * gününe denk gelsin (UTC günü gece 00:00-03:00 isteklerini bir önceki güne yazardı).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from './logger.js';

export type FallbackLevel = 0 | 1 | 2 | 3;

/** Platform panelinde gösterilen pencere (gün, bugün dahil). */
export const MATCHING_FALLBACK_WINDOW_DAYS = 30;
/** Pencerede bundan az istek varsa oran gösterilmez ("yetersiz veri") — tek tük istek yanıltır. */
export const MATCHING_FALLBACK_MIN_SAMPLE = 5;
const MATCHING_FALLBACK_TIMEZONE = 'Europe/Istanbul';

const istanbulDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: MATCHING_FALLBACK_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Verilen anın İstanbul takvim günü — `@db.Date` alanına yazılmak üzere 00:00 UTC olarak. */
export function istanbulDay(at: Date): Date {
  // en-CA biçimi YYYY-MM-DD verir.
  return new Date(`${istanbulDateFormat.format(at)}T00:00:00.000Z`);
}

/**
 * Sayacı bir artırır. `upsert` + `increment` tek satırda atomik artış yapar; iki istek aynı anda
 * günün İLK satırını oluşturmaya çalışırsa kaybeden P2002 (benzersizlik) alır → satır artık var,
 * bir kez `update` ile artırılır. Hata fırlatabilir — çağıran `trackMatchingFallback` yutar.
 */
export async function recordMatchingFallback(
  tenantId: string,
  level: FallbackLevel,
  at: Date = new Date(),
): Promise<void> {
  const day = istanbulDay(at);
  const where = { tenantId_day_level: { tenantId, day, level } };
  try {
    await prisma.matchingFallbackDailyStat.upsert({
      where,
      create: { tenantId, day, level, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      await prisma.matchingFallbackDailyStat.update({ where, data: { count: { increment: 1 } } });
      return;
    }
    throw err;
  }
}

/**
 * Yangın-ve-unut: eşleştirme yanıtını BEKLETMEZ ve sayaç yazımı başarısız olsa da yanıt aynı kalır
 * (AJ-105b dersi — beklenmeyen söz reddi `.catch` ile yakalanır, yalnız loglanır).
 */
export function trackMatchingFallback(tenantId: string, level: FallbackLevel): void {
  void recordMatchingFallback(tenantId, level).catch((err: unknown) =>
    void logger.warn('SYSTEM', 'Eşleştirme gevşetme sayacı yazılamadı', {
      tenantId,
      level,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

export interface MatchingFallbackRate {
  windowDays: number;
  /** Penceredeki toplam eşleştirme isteği (sonuç listesi boş olmayan). */
  totalRequests: number;
  /** fallbackLevel > 0 ile sonuçlanan istek sayısı. */
  relaxedRequests: number;
  byLevel: { level1: number; level2: number; level3: number };
  /** relaxed / total × 100, tek ondalık. Yetersiz veride null. */
  ratePercent: number | null;
  insufficientData: boolean;
  minSample: number;
}

/** Saf özet — birim testi: `tests/aj111-gevsetme-orani.unit.test.ts`. */
export function summarizeMatchingFallback(
  rows: ReadonlyArray<{ level: number; count: number }>,
): MatchingFallbackRate {
  const byLevel = { level1: 0, level2: 0, level3: 0 };
  let totalRequests = 0;
  for (const { level, count } of rows) {
    totalRequests += count;
    if (level === 1) byLevel.level1 += count;
    else if (level === 2) byLevel.level2 += count;
    else if (level === 3) byLevel.level3 += count;
  }
  const relaxedRequests = byLevel.level1 + byLevel.level2 + byLevel.level3;
  const insufficientData = totalRequests < MATCHING_FALLBACK_MIN_SAMPLE;
  const ratePercent = insufficientData
    ? null
    : Math.round((relaxedRequests / totalRequests) * 1000) / 10;
  return {
    windowDays: MATCHING_FALLBACK_WINDOW_DAYS,
    totalRequests,
    relaxedRequests,
    byLevel,
    ratePercent,
    insufficientData,
    minSample: MATCHING_FALLBACK_MIN_SAMPLE,
  };
}

/** Kurumun son `MATCHING_FALLBACK_WINDOW_DAYS` İstanbul gününün (bugün dahil) gevşetme oranı. */
export async function getMatchingFallbackRate(
  tenantId: string,
  now: Date = new Date(),
): Promise<MatchingFallbackRate> {
  const since = istanbulDay(now);
  since.setUTCDate(since.getUTCDate() - (MATCHING_FALLBACK_WINDOW_DAYS - 1));
  const grouped = await prisma.matchingFallbackDailyStat.groupBy({
    by: ['level'],
    where: { tenantId, day: { gte: since } },
    _sum: { count: true },
  });
  return summarizeMatchingFallback(grouped.map((g) => ({ level: g.level, count: g._sum.count ?? 0 })));
}
