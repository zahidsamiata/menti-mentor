/**
 * AJ-95a (madde 170) — Prisma `Json` alanlarına YAZIM öncesi yapı doğrulaması (psikometrik alanlar).
 *
 * Neden: `Json` sütunu veritabanında şekil zorlamaz; uygulama tipi (ör. `DiscVector`) yalnız
 * derleme zamanında vardı. Bir hesaplama hatası ya da yönetici API'sine gönderilen serbest bir
 * nesne, eşleştirmenin okuduğu alana (`discVector`) bozuk yapı yazabiliyordu — sonuç ancak okuma
 * tarafında (AJ-94 `parseDiscVector`) sessizce "vektör yok" yoluna düşmekti. Bu dosya psikometrik
 * `Json` alanlarının yazım şemalarını TEK yerde tutar; her yazım noktası buradan geçer.
 *
 * Fazla alan politikası: STRICT (bilinmeyen anahtar → red). Gerekçe:
 *   - Bu alanların hepsi sunucuda hesaplanır ya da yöneticiden gelir; meşru yazımda fazladan anahtar
 *     olmaz. Fazla anahtar = hata ya da enjeksiyon.
 *   - AJ-21: `discResultCard` içine ham vektör/puan (`discVector`, `rawScores`) gömülmesi, kart
 *     peer bakışında döndüğü için hassas veri sızıntısıydı. Strict şema bunu YAZIMDA da engeller.
 *   - Okuma tarafı (AJ-94 `parseDiscVector`) bilerek HOŞGÖRÜLÜ kalır: eski kayıtlarda fazladan
 *     anahtar olabilir, okuma onları yok sayar. Yazım sıkı, okuma hoşgörülü.
 *
 * Hata biçimi: `toValidatedJson` geçersiz yapıda `JsonFieldValidationError` fırlatır ve yazım
 * (prisma çağrısı) HİÇ yapılmaz. Sunucu-hesaplı yollarda bu bir iç hatadır → global hata işleyici
 * günlüğe yazar + 500 döner. Kullanıcı/yönetici girdisi olan yollarda aynı şemalar istek Zod
 * şemasına gömülür → mevcut `validateRequest` biçimiyle 400.
 * KVKK: hata mesajı yalnız alan adı + yol + Zod kodu taşır; DEĞER taşımaz (psikometrik veri günlüğe düşmez).
 *
 * Kapsam dışı (sonraki PR, AJ-95b/95c): kurum ayarları (`tenantVocabulary`, `limits`,
 * `blockedPairs`, `LearningStage.choices`), `selfProfile` ve CV alanları, `SystemLog.meta`,
 * `SjtOption.weights`.
 */

import { z } from 'zod';

const DISC_KEYS = ['D', 'I', 'S', 'C'] as const;

/** 0–1 aralığında sonlu sayı (zod v4 `number()` NaN/±Infinity'yi zaten reddeder). */
const unitInterval = z.number().min(0).max(1);

/** Kart metinleri için üst sınır — sunucu sabitlerinden gelir; sınır bomba/enjeksiyon koruması. */
const MAX_CARD_TEXT = 2000;
/**
 * Enneagram etiketi üst sınırı (ör. "8w7"). Tek kaynak: hem yazım şeması (`enneagramWing`) hem
 * mizaç testi istek şeması (`temperamentController`) bunu kullanır — istek bu sınırı aşarsa
 * yazım kapısında 500 yerine istekte 400 döner (AJ-109).
 */
export const MAX_ENNEAGRAM_LABEL = 20;
const MAX_CARD_STRENGTHS = 10;

/**
 * `User.discVector` — eşleştirmenin okuduğu kesirli DISC vektörü (`scoring.ts` `DiscVector`).
 * D/I/S/C ve confidence 0–1. D+I+S+C toplamı ZORLANMAZ: üç yazıcı farklı yuvarlama kullanır
 * (2 ve 3 hane), toplam 0.99–1.01 olabilir; toplam sınaması meşru yazımı reddederdi.
 */
export const DiscVectorWriteSchema = z.strictObject({
  D: unitInterval,
  I: unitInterval,
  S: unitInterval,
  C: unitInterval,
  confidence: unitInterval,
});

const discLetter = z.enum(DISC_KEYS);
const cardText = z.string().max(MAX_CARD_TEXT);

/**
 * `User.discResultCard` — onboarding "Aha Anı" arketip kartı (`onboardingController.ts` `submitDiscTest`).
 * Ham vektör/puan alanları YOK (AJ-21) — strict olduğu için gömülmeye çalışılırsa reddedilir.
 */
export const DiscResultCardWriteSchema = z.strictObject({
  archetype: cardText,
  icon: cardText,
  superPower: cardText,
  description: cardText,
  shareHeadline: cardText,
  strengths: z.array(cardText).max(MAX_CARD_STRENGTHS),
  growthArea: cardText,
  compatibleWith: z.array(discLetter).max(DISC_KEYS.length),
  dominant: discLetter,
  completedAt: z.iso.datetime(),
});

const discCountRecord = z.strictObject({
  D: z.number().int().min(0),
  I: z.number().int().min(0),
  S: z.number().int().min(0),
  C: z.number().int().min(0),
});

const percentageRecord = z.strictObject({
  D: z.number().min(0).max(100),
  I: z.number().min(0).max(100),
  S: z.number().min(0).max(100),
  C: z.number().min(0).max(100),
});

/**
 * `User.temperamentJson` — mizaç testi sonucu (`temperamentAnalysis.ts` `TemperamentResult`).
 * Yazıcılar: `temperamentController.submitTemperamentTest` (sunucu hesaplı) ve yöneticinin
 * `createUser`/`updateUser` gövdesi (istek şemasına gömülü → 400).
 */
export const TemperamentResultWriteSchema = z.strictObject({
  dominantDisc: discLetter,
  scores: discCountRecord,
  percentages: percentageRecord,
  enneagramWing: z.string().max(MAX_ENNEAGRAM_LABEL).nullable(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type PsychometricJsonField = 'discVector' | 'discResultCard' | 'temperamentJson';

/** Yazım öncesi doğrulama hatası — değer değil, yalnız alan adı + sorunlu yollar taşır (KVKK). */
export class JsonFieldValidationError extends Error {
  constructor(
    readonly field: PsychometricJsonField,
    readonly issues: ReadonlyArray<{ path: string; code: string }>,
  ) {
    super(
      `Json alanı yazım öncesi doğrulanamadı: ${field} (${issues
        .map((i) => `${i.path || '<kök>'}:${i.code}`)
        .join(', ')})`,
    );
    this.name = 'JsonFieldValidationError';
  }
}

/**
 * Değeri şemaya göre doğrular ve (Prisma'ya yazılacak) doğrulanmış kopyasını döner.
 * Geçersizse `JsonFieldValidationError` fırlatır — çağıran prisma yazımına HİÇ ulaşmaz.
 */
export function toValidatedJson<S extends z.ZodType>(
  field: PsychometricJsonField,
  schema: S,
  value: unknown,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new JsonFieldValidationError(
      field,
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    );
  }
  return parsed.data;
}
