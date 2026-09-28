/**
 * AJ-95a (madde 170) — psikometrik `Json` alanlarının yazım şemaları (DB'siz, saf).
 *
 * Ölçüt: her şema için geçerli örnek geçer; eksik anahtar, yanlış tip, NaN/Infinity, aralık dışı
 * ve FAZLA alan reddedilir (politika strict — gerekçe `src/services/jsonFieldSchemas.ts` başlığında).
 * `toValidatedJson` geçersizde değer sızdırmayan `JsonFieldValidationError` fırlatır.
 */

import { describe, it, expect } from 'vitest';
import {
  DiscResultCardWriteSchema,
  DiscVectorWriteSchema,
  JsonFieldValidationError,
  TemperamentResultWriteSchema,
  toValidatedJson,
} from '../src/services/jsonFieldSchemas.js';
import { parseDiscVector } from '../src/services/scoring.js';

const validVector = { D: 0.4, I: 0.3, S: 0.2, C: 0.1, confidence: 0.75 };

const validCard = {
  archetype: 'Öncü',
  icon: '🦅',
  superPower: 'Kararları hızla alır ve harekete geçersin',
  description: 'Açıklama',
  shareHeadline: 'Paylaşım başlığı',
  strengths: ['Liderlik', 'Cesaret'],
  growthArea: 'Sabır',
  compatibleWith: ['S', 'C'],
  dominant: 'D',
  completedAt: '2026-09-28T10:00:00.000Z',
};

const validTemperament = {
  dominantDisc: 'D',
  scores: { D: 4, I: 1, S: 1, C: 1 },
  percentages: { D: 57.1, I: 14.3, S: 14.3, C: 14.3 },
  enneagramWing: '8w7',
  confidence: 'HIGH',
};

describe('DiscVectorWriteSchema', () => {
  it('geçerli vektör geçer ve okuma kapısı (parseDiscVector) da aynı nesneyi kabul eder', () => {
    const r = DiscVectorWriteSchema.safeParse(validVector);
    expect(r.success).toBe(true);
    expect(parseDiscVector(r.data)).toEqual(validVector);
  });

  it('sınır değerler (0 ve 1) geçer — eşit dağılım önceliği ve tam güven', () => {
    expect(DiscVectorWriteSchema.safeParse({ D: 0.25, I: 0.25, S: 0.25, C: 0.25, confidence: 0 }).success).toBe(true);
    expect(DiscVectorWriteSchema.safeParse({ D: 1, I: 0, S: 0, C: 0, confidence: 1 }).success).toBe(true);
  });

  it.each([
    ['eksik anahtar (confidence yok — PS-02 hata zinciri)', { D: 0.4, I: 0.3, S: 0.2, C: 0.1 }],
    ['eksik boyut', { D: 0.4, I: 0.3, S: 0.3, confidence: 1 }],
    ['yanlış tip (metin)', { ...validVector, D: '0.4' }],
    ['NaN', { ...validVector, I: Number.NaN }],
    ['Infinity', { ...validVector, S: Number.POSITIVE_INFINITY }],
    ['negatif', { ...validVector, C: -0.1 }],
    ['1 üstü', { ...validVector, confidence: 1.5 }],
    ['fazla alan (ham puan gömme)', { ...validVector, rawScores: { D: 3 } }],
    ['dizi', [0.4, 0.3, 0.2, 0.1, 1]],
    ['null', null],
  ])('reddeder: %s', (_label, value) => {
    expect(DiscVectorWriteSchema.safeParse(value).success).toBe(false);
  });
});

describe('DiscResultCardWriteSchema', () => {
  it('geçerli kart geçer', () => {
    expect(DiscResultCardWriteSchema.safeParse(validCard).success).toBe(true);
  });

  it.each([
    ['eksik anahtar', (({ archetype: _a, ...rest }) => rest)(validCard)],
    ['yanlış tip (strengths metin)', { ...validCard, strengths: 'Liderlik' }],
    ['geçersiz baskın harf', { ...validCard, dominant: 'X' }],
    ['geçersiz uyum harfi', { ...validCard, compatibleWith: ['Z'] }],
    ['tarih değil', { ...validCard, completedAt: 'dün' }],
    ['AJ-21: karta ham discVector gömülemez', { ...validCard, discVector: validVector }],
    ['AJ-21: karta ham rawScores gömülemez', { ...validCard, rawScores: { D: 3, I: 1, S: 1, C: 1 } }],
  ])('reddeder: %s', (_label, value) => {
    expect(DiscResultCardWriteSchema.safeParse(value).success).toBe(false);
  });
});

describe('TemperamentResultWriteSchema', () => {
  it('geçerli sonuç geçer; enneagramWing null da geçer', () => {
    expect(TemperamentResultWriteSchema.safeParse(validTemperament).success).toBe(true);
    expect(TemperamentResultWriteSchema.safeParse({ ...validTemperament, enneagramWing: null }).success).toBe(true);
  });

  it.each([
    ['eksik anahtar', (({ confidence: _c, ...rest }) => rest)(validTemperament)],
    ['yanlış tip (confidence sayı)', { ...validTemperament, confidence: 0.9 }],
    ['NaN yüzde', { ...validTemperament, percentages: { ...validTemperament.percentages, D: Number.NaN } }],
    ['kesirli sayım', { ...validTemperament, scores: { ...validTemperament.scores, D: 3.5 } }],
    ['100 üstü yüzde', { ...validTemperament, percentages: { ...validTemperament.percentages, I: 120 } }],
    ['fazla alan', { ...validTemperament, note: 'serbest' }],
    ['iç kayıtta fazla alan', { ...validTemperament, scores: { ...validTemperament.scores, X: 1 } }],
    ['serbest nesne (eski boundedJson kabul ediyordu)', { anything: true }],
  ])('reddeder: %s', (_label, value) => {
    expect(TemperamentResultWriteSchema.safeParse(value).success).toBe(false);
  });
});

describe('toValidatedJson', () => {
  it('geçerli değeri doğrulanmış kopya olarak döner', () => {
    expect(toValidatedJson('discVector', DiscVectorWriteSchema, validVector)).toEqual(validVector);
  });

  it('geçersizde JsonFieldValidationError fırlatır; mesaj alan+yol taşır, DEĞER taşımaz (KVKK)', () => {
    const secretish = { ...validVector, D: 'GIZLI-DEGER-0.987' };
    let caught: unknown;
    try {
      toValidatedJson('discVector', DiscVectorWriteSchema, secretish);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(JsonFieldValidationError);
    const e = caught as JsonFieldValidationError;
    expect(e.field).toBe('discVector');
    expect(e.issues.map((i) => i.path)).toContain('D');
    expect(e.message).toContain('discVector');
    expect(e.message).not.toContain('GIZLI-DEGER');
  });
});
