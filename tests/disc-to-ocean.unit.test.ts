/**
 * PS-A1 (KARAR-10, AŞAMA 1) — DISC→OCEAN ölçek düzeltmesi BİRİM testleri (DB bağımsız).
 *
 * Kök sebep: `UserProfile.discD/I/S/C` (discVectorService.recalcDiscVector) D+I+S+C toplamı
 * 1.0'a normalize edilmiş bir ORANDIR (0-1 aralığı). `discToOcean` ise `50 + (50*raw)/100`
 * formülüyle onlarca birim genişlikte bir 0-100 ölçeği bekler. Daha önce `scoring.service.ts`
 * bu iki ölçek arasında HİÇBİR dönüşüm yapmadan 0-1 değerlerini doğrudan `discToOcean`'a
 * geçiyordu → `raw` neredeyse hep [-0.5, 0.6] aralığında kalıyor, ocean çıktısı
 * [49.75, 50.30]'a sıkışıyor ve `ARCHETYPE_THRESHOLDS` (60/55/45) hiçbir zaman aşılamıyordu.
 * `toOceanScale()` bu dönüşümü tek, isimli bir noktada yapar.
 *
 *   npx vitest run tests/disc-to-ocean.unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import { discToOcean, deriveArchetype, toOceanScale } from '../src/services/disc-to-ocean.adapter.js';
import { ARCHETYPE_THRESHOLDS, type OceanVector } from '../src/services/scoring.config.js';

const { HIGH, MID, LOW } = ARCHETYPE_THRESHOLDS;

// D+I+S+C toplamı 1.0'a normalize edilmiş dört "saf boyut" vektörü —
// discVectorService.recalcDiscVector'ın üretebileceği gerçekçi uç noktalar.
const PURE_VECTORS = [
  { name: 'saf D', vec: { D: 1, I: 0, S: 0, C: 0 } },
  { name: 'saf I', vec: { D: 0, I: 1, S: 0, C: 0 } },
  { name: 'saf S', vec: { D: 0, I: 0, S: 1, C: 0 } },
  { name: 'saf C', vec: { D: 0, I: 0, S: 0, C: 1 } },
];

describe('toOceanScale: 0-1 (oran) → 0-100 ölçek dönüşümü', () => {
  it('her bileşeni 100 ile çarpar', () => {
    expect(toOceanScale({ D: 0.4, I: 0.3, S: 0.2, C: 0.1 })).toEqual({
      d: 40, i: 30, s: 20, c: 10,
    });
  });

  it('D+I+S+C=1 olan bir oran vektöründe çıktı bileşenleri toplamı 100 eder', () => {
    for (const { vec } of PURE_VECTORS) {
      const scaled = toOceanScale(vec);
      expect(scaled.d + scaled.i + scaled.s + scaled.c).toBeCloseTo(100);
    }
    const equal = toOceanScale({ D: 0.25, I: 0.25, S: 0.25, C: 0.25 });
    expect(equal).toEqual({ d: 25, i: 25, s: 25, c: 25 });
  });

  it('sıfır vektörü sıfır kalır (kenar durumu)', () => {
    expect(toOceanScale({ D: 0, I: 0, S: 0, C: 0 })).toEqual({ d: 0, i: 0, s: 0, c: 0 });
  });
});

describe('REGRESYON — discToOcean 0-1 (oran) girdiyle ÇAĞRILIRSA dar aralığa sıkışır', () => {
  // Bu blok BİLEREK eski hatalı çağrı şeklini (toOceanScale UYGULANMADAN) test eder.
  // Amaç: discToOcean'ın matematiğinin GERÇEKTEN 0-100 ölçeği varsaydığını belgelemek —
  // bu testler PASS olduğu sürece "sessizce yanlış ölçek besleme" hatası tekrar fark edilebilir
  // (ör. biri ileride toOceanScale çağrısını kaldırırsa, discToOcean testleri kırılmadan
  // bu regresyon testi hâlâ [49.75,50.30] bandını doğrular — gerçek girdinin skalası
  // yanlışsa sonuç hep bu dar banda düşer).
  it.each(PURE_VECTORS)('$name — ölçeksiz (0-1) girdi verilirse HİÇBİR eşik (45/55/60) aşılmaz', ({ vec }) => {
    // KASITLI: toOceanScale çağrılmadı — bu, PS-A1 ÖNCESİ scoring.service.ts'in yaptığı hatadır.
    const ocean = discToOcean({ d: vec.D, i: vec.I, s: vec.S, c: vec.C });
    for (const key of ['o', 'c', 'e', 'a', 'n'] as const) {
      expect(ocean[key]).toBeGreaterThanOrEqual(49.7);
      expect(ocean[key]).toBeLessThanOrEqual(50.35);
      // Dar banda sıkışan değer hiçbir eşiği (LOW=45, MID=55, HIGH=60) aşamaz →
      // deriveArchetype'ın hiçbir gerçek dalı (M2/M3/M4/m2/m3/m4) tetiklenemezdi.
      expect(ocean[key]).toBeGreaterThan(LOW);
      expect(ocean[key]).toBeLessThan(MID);
      expect(ocean[key]).toBeLessThan(HIGH);
    }
  });

  it('eşit dağılım (D=I=S=C=0.25, "sinyal yok") da dar banda düşer', () => {
    const ocean = discToOcean({ d: 0.25, i: 0.25, s: 0.25, c: 0.25 });
    expect(ocean.o).toBeCloseTo(50, 0);
    for (const key of ['o', 'c', 'e', 'a', 'n'] as const) {
      expect(Math.abs(ocean[key] - 50)).toBeLessThan(0.5);
    }
  });
});

describe('DÜZELTME — toOceanScale UYGULANDIKTAN sonra discToOcean eşikleri gerçekten aşabilir', () => {
  // Aynı "saf boyut" oranları, şimdi DOĞRU çağrı şekliyle: toOceanScale() → discToOcean().
  // scoring.service.ts'in artık yaptığı budur (bkz. src/services/scoring.service.ts).
  it('saf D (baskın Dominance) → conscientiousness HIGH eşiğini (>60) ve agreeableness LOW eşiğini (<45) aşar', () => {
    const ocean = discToOcean(toOceanScale({ D: 1, I: 0, S: 0, C: 0 }));
    expect(ocean.c).toBeGreaterThan(HIGH);
    expect(ocean.a).toBeLessThan(LOW);
  });

  it('saf I (baskın Influence) → openness ve extraversion HIGH eşiğini (>60) aşar', () => {
    const ocean = discToOcean(toOceanScale({ D: 0, I: 1, S: 0, C: 0 }));
    expect(ocean.o).toBeGreaterThan(HIGH);
    expect(ocean.e).toBeGreaterThan(HIGH);
  });

  it('saf S (baskın Steadiness) → agreeableness HIGH eşiğini (>60) aşar', () => {
    const ocean = discToOcean(toOceanScale({ D: 0, I: 0, S: 1, C: 0 }));
    expect(ocean.a).toBeGreaterThan(HIGH);
  });

  it('saf C (baskın Compliance) → conscientiousness HIGH eşiğini (>60) aşar', () => {
    const ocean = discToOcean(toOceanScale({ D: 0, I: 0, S: 0, C: 1 }));
    expect(ocean.c).toBeGreaterThan(HIGH);
  });
});

describe('deriveArchetype — MENTOR dallarının HER BİRİ tetiklenebilir (elle kurulmuş ocean vektörleri)', () => {
  // Sıra if-chain sırasıyla BİREBİR eşleşir (scoring.config.ts ARCHETYPE_THRESHOLDS: HIGH=60, MID=55, LOW=45).
  // Her vektör yalnız hedeflenen dalı tetikleyecek şekilde kurulmuştur (önceki dallar kasıtlı false).
  const cases: Array<{ name: string; ocean: OceanVector; expected: string }> = [
    { name: 'M1 — c>60 && o>60', ocean: { o: 70, c: 70, e: 50, a: 50, n: 50 }, expected: 'M1' },
    { name: 'M2 — o>60 && e>60 (c değil)', ocean: { o: 70, c: 50, e: 70, a: 50, n: 50 }, expected: 'M2' },
    { name: 'M4 — c>60 && a<45 (o değil)', ocean: { o: 50, c: 70, e: 50, a: 30, n: 50 }, expected: 'M4' },
    { name: 'M3 — a>60 (diğerleri değil)', ocean: { o: 50, c: 50, e: 50, a: 70, n: 50 }, expected: 'M3' },
    { name: 'varsayılan — hiçbir koşul tutmuyor', ocean: { o: 50, c: 50, e: 50, a: 50, n: 50 }, expected: 'M1' },
  ];

  it.each(cases)('$name → $expected', ({ ocean, expected }) => {
    expect(deriveArchetype(ocean, 'MENTOR')).toBe(expected);
  });
});

describe('deriveArchetype — MENTİ dallarının HER BİRİ tetiklenebilir (elle kurulmuş ocean vektörleri)', () => {
  const cases: Array<{ name: string; ocean: OceanVector; expected: string }> = [
    { name: 'm3 — a>55 && n>55', ocean: { o: 50, c: 50, e: 50, a: 70, n: 70 }, expected: 'm3' },
    { name: 'm4 — e>60 && a<45 (m3 değil)', ocean: { o: 50, c: 50, e: 70, a: 30, n: 50 }, expected: 'm4' },
    { name: 'm2 — o>60 && c<45 (m3/m4 değil)', ocean: { o: 70, c: 30, e: 50, a: 50, n: 50 }, expected: 'm2' },
    { name: 'm1 — c>60 && o<55 (m2/m3/m4 değil)', ocean: { o: 40, c: 70, e: 50, a: 50, n: 50 }, expected: 'm1' },
    { name: 'varsayılan — hiçbir koşul tutmuyor', ocean: { o: 50, c: 50, e: 50, a: 50, n: 50 }, expected: 'm1' },
  ];

  it.each(cases)('$name → $expected', ({ ocean, expected }) => {
    expect(deriveArchetype(ocean, 'MENTI')).toBe(expected);
  });
});

describe('Negatif — eski hata (her zaman M1/m1) bir daha mümkün değil', () => {
  it('4 saf boyut de doğru ölçekte MENTOR için M1 dışı bir arketip üretebiliyor', () => {
    const results = PURE_VECTORS.map(({ vec }) =>
      deriveArchetype(discToOcean(toOceanScale(vec)), 'MENTOR'),
    );
    // PS-A1 öncesi hata: hepsi her zaman 'M1' idi (ocean hiçbir eşiği aşamıyordu).
    expect(results.some((r) => r !== 'M1')).toBe(true);
  });

  it('4 saf boyut de doğru ölçekte MENTİ için m1 dışı bir arketip üretebiliyor', () => {
    const results = PURE_VECTORS.map(({ vec }) =>
      deriveArchetype(discToOcean(toOceanScale(vec)), 'MENTI'),
    );
    // PS-A1 öncesi hata: hepsi her zaman 'm1' idi.
    expect(results.some((r) => r !== 'm1')).toBe(true);
  });
});
