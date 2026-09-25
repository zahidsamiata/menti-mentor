/**
 * K-08 — isPlatformUrl saf fonksiyon testleri.
 */
import { describe, it, expect } from 'vitest';
import { isPlatformUrl } from '../src/services/socialUrl.js';

describe('isPlatformUrl', () => {
  it('platformun kendi alan adını ve alt alan adlarını kabul eder', () => {
    expect(isPlatformUrl('https://linkedin.com/in/a', 'linkedin')).toBe(true);
    expect(isPlatformUrl('https://www.linkedin.com/in/a', 'linkedin')).toBe(true);
    expect(isPlatformUrl('https://tr.linkedin.com/in/a', 'linkedin')).toBe(true);
    expect(isPlatformUrl('https://www.instagram.com/a', 'instagram')).toBe(true);
  });

  it('negatif: başka site, benzer görünen alan adı ve http(s) dışı şema reddedilir', () => {
    expect(isPlatformUrl('https://youtube.com/a', 'linkedin')).toBe(false);
    expect(isPlatformUrl('https://linkedin.com.example.com/a', 'linkedin')).toBe(false);
    expect(isPlatformUrl('https://evillinkedin.com/a', 'linkedin')).toBe(false);
    expect(isPlatformUrl('javascript:alert(1)', 'linkedin')).toBe(false);
    expect(isPlatformUrl('linkedin.com/in/a', 'linkedin')).toBe(false);
    expect(isPlatformUrl('https://instagram.com/a', 'linkedin')).toBe(false);
  });
});
