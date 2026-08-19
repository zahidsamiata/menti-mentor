/**
 * DISC çoklu-harf birim testleri (KARAR 1 · iş #12) — saf mantık, DB gerektirmez.
 *
 * Not: proje vitest config'i globalSetup ile test DB migration'ı çalıştırır; bu dosyanın
 * MANTIĞI DB'siz olsa da suite CI'da (DB mevcut) birlikte koşar. Yerel saf-mantık kanıtı
 * için `computeDiscLetters` ayrıca tsx ile doğrudan da çalıştırılabilir.
 *
 * Eşikler: orta çizgi 0.25 (normalize vektör) + BÜYÜK/küçük = birincilin %75'i (PO onayı 2026-08-17).
 */

import { describe, it, expect } from 'vitest';
import { computeDiscLetters, DISC_LETTER_CONFIG } from '../src/services/discLetters.js';

describe('computeDiscLetters — DISC çoklu harf (KARAR 1)', () => {
  it('saf stil: tek tip orta çizgiyi geçer → tek BÜYÜK harf', () => {
    expect(computeDiscLetters({ D: 0.7, I: 0.1, S: 0.1, C: 0.1 })).toBe('D');
  });

  it('iki güçlü yakın tip → iki BÜYÜK harf "DI"', () => {
    // birincil D=0.40, eşik=0.30; I=0.31 ≥ 0.30 → BÜYÜK
    expect(computeDiscLetters({ D: 0.4, I: 0.31, S: 0.17, C: 0.12 })).toBe('DI');
  });

  it('baskın + destekleyici (zayıfça geçen) → "Di"', () => {
    // birincil D=0.40, eşik=0.30; I=0.28 > 0.25 (gösterilir) ama < 0.30 → küçük
    expect(computeDiscLetters({ D: 0.4, I: 0.28, S: 0.2, C: 0.12 })).toBe('Di');
  });

  it('üç harf: iki güçlü + zayıfça geçen → "DIs"', () => {
    // birincil D=0.38, eşik=0.285; I=0.30 ≥ eşik → BÜYÜK; S=0.26 > 0.25 gösterilir, < eşik → küçük
    expect(computeDiscLetters({ D: 0.38, I: 0.3, S: 0.26, C: 0.06 })).toBe('DIs');
  });

  it('orta çizgi sınırı: tam 0.25 gösterilmez (strict >)', () => {
    expect(computeDiscLetters({ D: 0.5, I: 0.25, S: 0.15, C: 0.1 })).toBe('D');
  });

  it('düz/eşit profil (hepsi 0.25) → yalnız birincil (tie-break D)', () => {
    expect(computeDiscLetters({ D: 0.25, I: 0.25, S: 0.25, C: 0.25 })).toBe('D');
  });

  it('birincil eşitliği: tie-break D > I > S > C', () => {
    // D=I=0.35 → birincil D; I 0.35 ≥ eşik(0.2625) → "DI"
    expect(computeDiscLetters({ D: 0.35, I: 0.35, S: 0.2, C: 0.1 })).toBe('DI');
  });

  it('güçten zayıfa sıralama: I birincil olabilir → "Id"', () => {
    // I=0.45 birincil, eşik=0.3375; D=0.30 > 0.25 gösterilir, < eşik → küçük
    expect(computeDiscLetters({ D: 0.3, I: 0.45, S: 0.15, C: 0.1 })).toBe('Id');
  });

  it('geçersiz/eksik girdi → boş dizge', () => {
    expect(computeDiscLetters(null)).toBe('');
    expect(computeDiscLetters(undefined)).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeDiscLetters({ D: NaN, I: 0.3, S: 0.3, C: 0.4 } as any)).toBe('');
  });

  it('eşikler tek merkezi configten okunur (kalibrasyon noktası)', () => {
    expect(DISC_LETTER_CONFIG.midline).toBe(0.25);
    expect(DISC_LETTER_CONFIG.uppercaseRatioOfPrimary).toBe(0.75);
  });
});
