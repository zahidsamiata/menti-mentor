/**
 * AN-39 — parsePagination saf fonksiyon testleri.
 */
import { describe, it, expect } from 'vitest';
import { parsePagination } from '../src/services/pagination.js';

const B = { defaultLimit: 50, maxLimit: 100 };

describe('parsePagination', () => {
  it('eksik değerde varsayılan sayfa', () => {
    expect(parsePagination(undefined, undefined, B)).toEqual({ limit: 50, offset: 0 });
    expect(parsePagination('', '', B)).toEqual({ limit: 50, offset: 0 });
  });

  it('geçerli değerleri kullanır, ondalığı keser', () => {
    expect(parsePagination('20', '40', B)).toEqual({ limit: 20, offset: 40 });
    expect(parsePagination('20.9', '3.7', B)).toEqual({ limit: 20, offset: 3 });
  });

  it('negatif: üst sınırı aşamaz, 1 altına inemez, geçersiz offset 0 olur', () => {
    expect(parsePagination('100000', '0', B).limit).toBe(100);
    expect(parsePagination('0', '0', B).limit).toBe(1);
    expect(parsePagination('-3', '-10', B)).toEqual({ limit: 1, offset: 0 });
    expect(parsePagination('abc', 'xyz', B)).toEqual({ limit: 50, offset: 0 });
  });
});
