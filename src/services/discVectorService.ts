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
 * Dört boyutun toplamı 0 ise (tüm cevaplar Likert 1) vektör eşit dağılımdır (0.25) — AJ-108.
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
import { parseDiscVector, type DiscVector } from './scoring.js';
import { DiscVectorWriteSchema, toValidatedJson } from './jsonFieldSchemas.js';

// Tip doğrulama guard'ı `parseDiscVector` AJ-94'te saf `scoring.ts`'e taşındı ve dışa açıldı
// (eşleştirme + analitik aynı kapıyı kullansın diye).

// ─── Dinamik güven hedefi — TTL cache ────────────────────────────────────────

/**
 * Aktif boyutsal soru sayısı için 5 dakikalık in-memory cache — KURUM BAŞINA.
 *
 * Tasarım kararı: Soru havuzu nadiren değişir (admin işlemi); her yanıt
 * kaydında DB'ye sorgu atmak orantısız bir yük oluşturur. 5 dk TTL ile:
 *  - Admin soru eklerse/silerse maksimum 5 dk gecikmeli yansır (kabul edilebilir)
 *  - Yoğun test oturumlarında N kez DB sorgusu yerine 1 sorgu + cache hit
 *
 * Kurum izolasyonu (PS-06): payda = global sorular (tenantId null) + YALNIZ
 * kullanıcının kurumunun soruları. Kurum admini kendi kurumuna boyutlu soru
 * ekleyebildiği için (questionController.createQuestion) tek global sayaç başka
 * kurumun sorularını paydaya katıyor, güveni olduğundan düşük gösteriyordu.
 * Havuz tanımı `validateQuestionIds` / `buildQuestionList` ile aynı OR filtresidir.
 * Cache anahtarı bu yüzden tenantId'dir — bir kurumun sayısı diğerine dönmez.
 */
const dimensionalCountCache = new Map<string, { value: number; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika

async function getDimensionalQuestionCount(tenantId: string): Promise<number> {
  const now = Date.now();
  const cached = dimensionalCountCache.get(tenantId);
  if (cached && now < cached.expiresAt) {
    return cached.value;
  }
  const count = await prisma.question.count({
    where: {
      isActive: true,
      discDimension: { not: 'GENERAL' },
      OR: [{ tenantId: null }, { tenantId }],
    },
  });
  dimensionalCountCache.set(tenantId, { value: count, expiresAt: now + CACHE_TTL_MS });
  return count;
}

/**
 * Cache'i manuel geçersiz kıl — soru eklenip/silindiğinde çağrılabilir.
 * Tüm kurumların girdisini temizler: global soru değişimi herkesi etkiler,
 * ayrıca soru nadiren değiştiği için hedefli silmenin kazancı yok.
 */
export function invalidateDimensionalCountCache(): void {
  dimensionalCountCache.clear();
}

// ─── Vektör hesaplama ─────────────────────────────────────────────────────────

/**
 * Dört boyutun eşit payı (1/4). İki yerde kullanılır: cevapsız boyutun prioru ve dört boyutun
 * toplamı 0 olduğunda (tüm cevaplar Likert 1) geri dönüş vektörü — uyarlanabilir motorun
 * `normalizeToVector` total===0 korumasıyla aynı sonuç (adaptiveTestEngine.ts).
 */
const DISC_EQUAL_SHARE = 0.25;

/**
 * Kullanıcının tüm yanıtlarından DISC vektörünü yeniden hesaplar ve DB'e yazar.
 *
 * @param userId - Hesaplama yapılacak kullanıcı ID'si
 * @param tenantId - İsteğin kurumu; güven paydası bu kurumun havuzuna göre hesaplanır
 * @returns Güncellenmiş DiscVector
 */
export async function recalcDiscVector(userId: string, tenantId: string): Promise<DiscVector> {
  const [responses, dimensionalTotal] = await Promise.all([
    prisma.userResponse.findMany({
      where: { userId },
      include: { question: { select: { discDimension: true, isActive: true } } },
    }),
    getDimensionalQuestionCount(tenantId),
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

  // Boyut ortalamaları — hiç cevap yoksa prior olarak eşit pay (DISC_EQUAL_SHARE)
  const raw: Record<(typeof DISC_DIMS)[number], number> = {
    D: buckets.D.length > 0 ? arithmeticMean(buckets.D) : DISC_EQUAL_SHARE,
    I: buckets.I.length > 0 ? arithmeticMean(buckets.I) : DISC_EQUAL_SHARE,
    S: buckets.S.length > 0 ? arithmeticMean(buckets.S) : DISC_EQUAL_SHARE,
    C: buckets.C.length > 0 ? arithmeticMean(buckets.C) : DISC_EQUAL_SHARE,
  };

  // D + I + S + C toplamını 1.0'a normalize et.
  // AJ-108: dört boyut da cevaplı ve hepsi Likert 1 ise toplam 0 → bölme NaN üretir ve yazım
  // doğrulaması reddeder (kullanıcı ilerleyemez). Bu durumda eşit dağılım döner.
  const sum = raw.D + raw.I + raw.S + raw.C;
  const share = (value: number) => (sum === 0 ? DISC_EQUAL_SHARE : round3(value / sum));

  const vector: DiscVector = {
    D: share(raw.D),
    I: share(raw.I),
    S: share(raw.S),
    C: share(raw.C),
    // confidence = cevaplanmış / hedef, maksimum 1.0
    // dimensionalTotal = 0 ise henüz soru yok → confidence = 0
    confidence: dimensionalTotal > 0
      ? Math.min(1, round3(dimensionalAnswered / dimensionalTotal))
      : 0,
  };

  await prisma.user.update({
    where: { id: userId },
    // AJ-95a: yapı yazımdan ÖNCE doğrulanır; geçersizse fırlatır, yazım yapılmaz.
    data: { discVector: toValidatedJson('discVector', DiscVectorWriteSchema, vector) },
  });

  // UserProfile'a normalize DISC bileşenlerini de yaz (skorlayıcının kullandığı kaynak).
  // upsert idempotenttir; profil yoksa oluşturur, varsa yalnızca DISC alanlarını günceller.
  await prisma.userProfile.upsert({
    where:  { userId },
    create: { userId, discD: vector.D, discI: vector.I, discS: vector.S, discC: vector.C },
    update: { discD: vector.D, discI: vector.I, discS: vector.S, discC: vector.C },
  });

  return vector;
}

/**
 * Kullanıcının mevcut discVector'unu DB'den okur.
 * Tip-güvenli parse: JSON → DiscVector | null
 */
export async function getDiscVector(userId: string): Promise<DiscVector | null> {
  // eslint-disable-next-line no-restricted-syntax -- id ile tekil okuma, yalnız discVector; şu an çağıranı yok — yeni çağıran kullanıcının kendi ya da aynı kurumdan olduğunu kendisi doğrulamalı
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
