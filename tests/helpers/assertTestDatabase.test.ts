import { describe, it, expect } from 'vitest';
import { assertSafeTestDatabase } from './assertTestDatabase.js';

// Gerçek DB'ye bağlanmaz — saf fonksiyonun karar mantığını doğrular.
describe('assertSafeTestDatabase', () => {
  const NEON =
    'postgresql://u:p@ep-fancy-tooth-ab4u5xhr-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require';
  const NEON_TEST_BRANCH =
    'postgresql://u:p@ep-test-branch-xyz.eu-west-2.aws.neon.tech/neondb?sslmode=require';
  const LOCAL = 'postgresql://postgres:postgres@localhost:5432/menti_mentor_test';

  it('TEST_DATABASE_URL yok + DATABASE_URL Neon → HATA (asıl koruma)', () => {
    expect(() => assertSafeTestDatabase({ DATABASE_URL: NEON })).toThrow(/GÜVENLİK KİLİDİ/);
  });

  it('hiçbiri tanımlı değil → HATA', () => {
    expect(() => assertSafeTestDatabase({})).toThrow(/yapılandırılmamış/);
  });

  it('boş/whitespace TEST_DATABASE_URL + Neon fallback → yine HATA', () => {
    expect(() => assertSafeTestDatabase({ TEST_DATABASE_URL: '   ', DATABASE_URL: NEON })).toThrow(
      /GÜVENLİK KİLİDİ/,
    );
  });

  it('DATABASE_URL localhost (CI backend, TEST_DATABASE_URL yok) → izin', () => {
    expect(assertSafeTestDatabase({ DATABASE_URL: LOCAL })).toBe(LOCAL);
  });

  it('TEST_DATABASE_URL=localhost === DATABASE_URL=localhost (CI çatı) → izin', () => {
    expect(
      assertSafeTestDatabase({ TEST_DATABASE_URL: LOCAL, DATABASE_URL: LOCAL }, { requireDistinct: true }),
    ).toBe(LOCAL);
  });

  it('ayrı Neon test branch → izin (test branch URL döner)', () => {
    expect(
      assertSafeTestDatabase(
        { TEST_DATABASE_URL: NEON_TEST_BRANCH, DATABASE_URL: NEON },
        { requireDistinct: true },
      ),
    ).toBe(NEON_TEST_BRANCH);
  });

  it('requireDistinct + TEST_DATABASE_URL canlı DATABASE_URL ile AYNI → HATA', () => {
    expect(() =>
      assertSafeTestDatabase({ TEST_DATABASE_URL: NEON, DATABASE_URL: NEON }, { requireDistinct: true }),
    ).toThrow(/aynı değere/);
  });
});
