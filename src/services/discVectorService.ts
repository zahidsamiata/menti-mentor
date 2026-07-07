/**
 * DISC Vektör Hesaplama Servisi
 *
 * ──────────────────────────────────────────────────────────────
 * Matematiksel Model
 * ──────────────────────────────────────────────────────────────
 *
 * Her Likert yanıtı (1–5) 0–1 aralığına normalize edilir:
 *   normalized = (value - 1) / 4
 *   Örn: 5 → 1.0,  3 → 0.5,  1 → 0.0
 *
 * Boyut skoru = o boyuttaki tüm normalize değerlerin aritmetik ortalaması.
 * Hiç cevaplanmamış boyut için varsayılan: 0.25 (eşit dağılım prioru)
 *
 * Normalizasyon adımı: D + I + S + C toplamı 1.0'a ölçeklenir.
 *   finalScore[dim] = raw[dim] / (raw.D + raw.I + raw.S + raw.C)
 *
 * Güven skoru (confidence):
 *   confidence = cevaplanmış_boyutsal_soru / toplam_aktif_boyutsal_soru
 *   GENERAL boyutlu sorular hesaba katılmaz (boyut discriminant'ı yoktur).
 *   Tüm boyutsal sorular cevaplanınca confidence = 1.0 (tam güven).
 *
 *   Önemli: confidence, pool büyüklüğüne göre dinamik hesaplanır.
 *   Admin soru eklerse confidence hedefi büyür; silerse küçülür.
 *   Sabit bir CONFIDENCE_TARGET sabiti kullanılmaz — bu admin-proof'tur.
 */

import { prisma } from '../db.js';
import type { DiscVector } from './scoring.js';

// ─── Tip doğrulama guard'ı ────────────────────────────────────────────────────

/**
 * Prisma'nın `Json` dönüş tipini `DiscVector`'e tip-güvenli şekilde dönüştürür.
 * `as unknown as DiscVector` kullanımını ortadan kaldırır.
 */
function parseDiscVector(raw: unknown): DiscVector | null {
  if (raw === null || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (
    typeof v['D'] !== 'number' ||
    typeof v['I'] !== 'number' ||
    typeof v['S'] !== 'number' ||
    typeof v['C'] !== 'number' ||
    typeof v['confidence'] !== 'number'
  ) {
    return null;
  }
  return { D: v['D'], I: v['I'], S: v['S'], C: v['C'], confidence: v['confidence'] };
}

// ─── Dinamik güven hedefi — TTL cache ────────────────────────────────────────

/**
 * Aktif boyutsal soru sayısı için 5 dakikalık in-memory cache.
 *
 * Tasarım kararı: Soru havuzu nadiren değişir (admin işlemi); her yanıt
 * kaydında DB'ye sorgu atmak orantısız bir yük oluşturur. 5 dk TTL ile:
 *  - Admin soru eklerse/silerse maksimum 5 dk gecikmeli yansır (kabul edilebilir)
 *  - Yoğun test oturumlarında N kez DB sorgusu yerine 1 sorgu + cache hit
 */
const dimensionalCountCache: { value: number | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika

async function getDimensionalQuestionCount(): Promise<number> {
  const now = Date.now();
  if (dimensionalCountCache.value !== null && now < dimensionalCountCache.expiresAt) {
    return dimensionalCountCache.value;
  }
  const count = await prisma.question.count({
    where: { isActive: true, discDimension: { not: 'GENERAL' } },
  });
  dimensionalCountCache.value = count;
  dimensionalCountCache.expiresAt = now + CACHE_TTL_MS;
  return count;
}

/** Cache'i manuel geçersiz kıl — soru eklenip/silindiğinde çağrılabilir. */
export function invalidateDimensionalCountCache(): void {
  dimensionalCountCache.value = null;
  dimensionalCountCache.expiresAt = 0;
}

// ─── Vektör hesaplama ─────────────────────────────────────────────────────────

/**
 * Kullanıcının tüm yanıtlarından DISC vektörünü yeniden hesaplar ve DB'e yazar.
 *
 * @param userId - Hesaplama yapılacak kullanıcı ID'si
 * @returns Güncellenmiş DiscVector
 */
export async function recalcDiscVector(userId: string): Promise<DiscVector> {
  const [responses, dimensionalTotal] = await Promise.all([
    prisma.userResponse.findMany({
      where: { userId },
      include: { question: { select: { discDimension: true, isActive: true } } },
    }),
    getDimensionalQuestionCount(),
  ]);

  // Yalnızca aktif sorulara verilen yanıtlar hesaba katılır.
  // Admin soruyu pasif yaparsa o yanıt otomatik dışlanır; yeniden hesap doğru kalır.
  const DISC_DIMS = ['D', 'I', 'S', 'C'] as const;
  const buckets: Record<(typeof DISC_DIMS)[number], number[]> = { D: [], I: [], S: [], C: [] };
  let dimensionalAnswered = 0;

  for (const r of responses) {
    if (!r.question.isActive) continue;
    const dim = r.question.discDimension;
    if (dim === 'GENERAL') continue;
    if (!DISC_DIMS.includes(dim as (typeof DISC_DIMS)[number])) continue;

    // normalize: Likert 1–5 → 0.0–1.0
    const normalized = (r.value - 1) / 4;
    buckets[dim as (typeof DISC_DIMS)[number]].push(normalized);
    dimensionalAnswered++;
  }

  // Boyut ortalamaları — hiç cevap yoksa prior olarak 0.25 (eşit dağılım)
  const raw: Record<(typeof DISC_DIMS)[number], number> = {
    D: buckets.D.length > 0 ? arithmeticMean(buckets.D) : 0.25,
    I: buckets.I.length > 0 ? arithmeticMean(buckets.I) : 0.25,
    S: buckets.S.length > 0 ? arithmeticMean(buckets.S) : 0.25,
    C: buckets.C.length > 0 ? arithmeticMean(buckets.C) : 0.25,
  };

  // D + I + S + C toplamını 1.0'a normalize et
  const sum = raw.D + raw.I + raw.S + raw.C;

  const vector: DiscVector = {
    D: round3(raw.D / sum),
    I: round3(raw.I / sum),
    S: round3(raw.S / sum),
    C: round3(raw.C / sum),
    // confidence = cevaplanmış / hedef, maksimum 1.0
    // dimensionalTotal = 0 ise henüz soru yok → confidence = 0
    confidence: dimensionalTotal > 0
      ? Math.min(1, round3(dimensionalAnswered / dimensionalTotal))
      : 0,
  };

  await prisma.user.update({
    where: { id: userId },
    data: { discVector: vector satisfies object },
  });

  return vector;
}

/**
 * Kullanıcının mevcut discVector'unu DB'den okur.
 * Tip-güvenli parse: JSON → DiscVector | null
 */
export async function getDiscVector(userId: string): Promise<DiscVector | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { discVector: true },
  });
  return parseDiscVector(user?.discVector ?? null);
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function arithmeticMean(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** 3 ondalık basamağa yuvarla (1000'de bire hassasiyet yeterli). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
