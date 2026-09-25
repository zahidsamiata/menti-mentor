/**
 * F-04 — kurum logosu adresi yalnız https (saf şema testi, DB'siz).
 */
import { describe, it, expect } from 'vitest';
import { logoUrlSchema } from '../src/services/logoUrl.js';

describe('F-04: logoUrlSchema', () => {
  it('https adresi kabul edilir', () => {
    expect(logoUrlSchema.safeParse('https://cdn.example.com/logo.png').success).toBe(true);
  });

  it('negatif: https dışındaki şemalar ve bozuk adres reddedilir', () => {
    for (const bad of [
      'http://example.com/logo.png',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'ftp://example.com/logo.png',
      '//example.com/logo.png',
      'logo.png',
      '',
    ]) {
      expect(logoUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('negatif: aşırı uzun adres reddedilir', () => {
    expect(logoUrlSchema.safeParse('https://e.com/' + 'a'.repeat(2100)).success).toBe(false);
  });
});
