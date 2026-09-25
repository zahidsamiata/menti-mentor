/**
 * KR-13 — probe betikleri yalnız açıkça verilmiş, canlıdan farklı test veritabanıyla çalışır.
 */
import { describe, it, expect } from 'vitest';
import { resolveProbeDatabaseUrl } from './helpers/probeGuard.js';

const LIVE = 'postgresql://u:p@ep-example-123.eu-west-2.aws.neon.tech/neondb?sslmode=require';
const LOCAL_TEST = 'postgresql://u:p@localhost:5432/menti_test';

describe('KR-13: resolveProbeDatabaseUrl', () => {
  it('açık ve ayrı test veritabanı kabul edilir', () => {
    expect(resolveProbeDatabaseUrl({ TEST_DATABASE_URL: LOCAL_TEST, DATABASE_URL: LIVE })).toBe(LOCAL_TEST);
  });

  it('negatif: TEST_DATABASE_URL yoksa .env adresine düşmez, durur', () => {
    expect(() => resolveProbeDatabaseUrl({ DATABASE_URL: LIVE })).toThrow(/PROBE KİLİDİ/);
    expect(() => resolveProbeDatabaseUrl({ DATABASE_URL: LOCAL_TEST })).toThrow(/PROBE KİLİDİ/);
  });

  it('negatif: test adresi canlı adresle aynıysa durur', () => {
    expect(() => resolveProbeDatabaseUrl({ TEST_DATABASE_URL: LIVE, DATABASE_URL: LIVE })).toThrow(/GÜVENLİK KİLİDİ/);
  });
});
