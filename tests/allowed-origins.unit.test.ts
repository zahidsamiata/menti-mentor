/**
 * Y-01 — CORS izinli origin parse'ı boşluk-toleranslı olmalı (saf mantık, DB gerektirmez).
 * Env'de virgülden sonra boşluk olsa bile origin doğru eşleşmeli; aksi halde site
 * sessizce açılmaz.
 */

import { describe, it, expect } from 'vitest';
import { parseAllowedOrigins } from '../src/config.js';

describe('parseAllowedOrigins — CORS origin boşluk toleransı (Y-01)', () => {
  it('virgülden sonra boşlukları temizler', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('baş/son boşluk ve sekmeleri temizler', () => {
    expect(parseAllowedOrigins('  https://a.com ,\thttps://b.com  ')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('boş parçaları atar (sondaki virgül, çift virgül)', () => {
    expect(parseAllowedOrigins('https://a.com,, ,https://b.com,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('undefined verilince varsayılan lokal origin listesine düşer', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([
      'http://localhost:3001',
      'http://127.0.0.1:3001',
    ]);
  });

  it('tek origin de düzgün döner', () => {
    expect(parseAllowedOrigins('https://app.example.com')).toEqual(['https://app.example.com']);
  });
});
