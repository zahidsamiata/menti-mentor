/**
 * Maskeleme yardımcıları — birim testi (DB gerektirmez).
 *
 * Kapsam (madde 68 regresyonu): listSuspicionReports raporlayan kimliğini (reporterName/contact)
 * maskeler. Bu dosya maskeleme mantığını saf fonksiyon düzeyinde kanıtlar — ham PII sızmaz.
 *
 * Tek başına koşum: npx vitest run tests/mask.unit.test.ts --reporter=verbose
 */

import { describe, it, expect } from 'vitest';
import { maskEmail, maskName, maskContact } from '../src/services/mask.js';

describe('maskEmail', () => {
  it('yerel kısmın yalnız ilk harfini gösterir, domain kalır', () => {
    expect(maskEmail('ornek@example.com')).toBe('o***@example.com');
  });

  it("'@' yoksa tamamen maskeler", () => {
    expect(maskEmail('duzsatir')).toBe('***');
  });

  it('boş/undefined → ***', () => {
    expect(maskEmail('')).toBe('***');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail(undefined)).toBe('***');
  });
});

describe('maskName — kişi adı yalnız ilk harf', () => {
  it('yalnız ilk harfi gösterir', () => {
    expect(maskName('Zeynep')).toBe('Z***');
  });

  it('baştaki/sondaki boşluğu kırpar, ilk gerçek harfi alır', () => {
    expect(maskName('  ali  ')).toBe('a***');
  });

  it('boş/whitespace/undefined → ***', () => {
    expect(maskName('')).toBe('***');
    expect(maskName('   ')).toBe('***');
    expect(maskName(null)).toBe('***');
    expect(maskName(undefined)).toBe('***');
  });

  it('tam ad response ham dönmez (kanıt: giriş çıktıya eşit değil)', () => {
    const raw = 'Mehmet Yilmaz';
    expect(maskName(raw)).not.toBe(raw);
    expect(maskName(raw)).not.toContain('ehmet');
  });
});

describe('maskContact — e-posta ise maskEmail, değilse ilk harf', () => {
  it('e-posta içeren iletişim maskEmail deseniyle maskelenir', () => {
    expect(maskContact('ornek@example.com')).toBe('o***@example.com');
  });

  it('telefon/handle yalnız ilk karakteri gösterir', () => {
    expect(maskContact('05551234567')).toBe('0***');
  });

  it('boş/undefined → ***', () => {
    expect(maskContact('')).toBe('***');
    expect(maskContact(null)).toBe('***');
    expect(maskContact(undefined)).toBe('***');
  });

  it('ham iletişim response ham dönmez (kanıt: giriş çıktıya eşit değil)', () => {
    const rawPhone = '05551234567';
    expect(maskContact(rawPhone)).not.toBe(rawPhone);
    expect(maskContact(rawPhone)).not.toContain('555');
  });
});
