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

  describe('KR-14 — aynı veritabanının farklı yazılışı korumayı geçemez', () => {
    const NEON_DIRECT =
      'postgresql://u:p@ep-fancy-tooth-ab4u5xhr.eu-west-2.aws.neon.tech/neondb?sslmode=require';
    const NEON_UPPER_PORT =
      'postgresql://other:pw@EP-FANCY-TOOTH-AB4U5XHR-POOLER.eu-west-2.aws.neon.tech:5432/neondb';

    it('pooler adresi ↔ doğrudan adres (aynı Neon DB) → HATA', () => {
      expect(() =>
        assertSafeTestDatabase({ TEST_DATABASE_URL: NEON_DIRECT, DATABASE_URL: NEON }, { requireDistinct: true }),
      ).toThrow(/aynı veritabanını/);
    });

    it('büyük harf + açık varsayılan port + farklı kullanıcı/parametre (aynı DB) → HATA', () => {
      expect(() =>
        assertSafeTestDatabase({ TEST_DATABASE_URL: NEON_UPPER_PORT, DATABASE_URL: NEON }, { requireDistinct: true }),
      ).toThrow(/aynı veritabanını/);
    });

    it('aynı sunucu, FARKLI veritabanı adı → izin', () => {
      const otherDb = NEON_DIRECT.replace('/neondb', '/menti_test');
      expect(
        assertSafeTestDatabase({ TEST_DATABASE_URL: otherDb, DATABASE_URL: NEON }, { requireDistinct: true }),
      ).toBe(otherDb);
    });

    it('canlı desenine uymayan uzak host da aynı DB ise → HATA (ör. docker `postgres` servisi)', () => {
      const PROD_LIKE = 'postgresql://app:pw@postgres:5432/menti';
      expect(() =>
        assertSafeTestDatabase({ TEST_DATABASE_URL: PROD_LIKE, DATABASE_URL: PROD_LIKE }, { requireDistinct: true }),
      ).toThrow(/aynı veritabanını/);
    });

    it('çözümlenemeyen uzak test adresi → HATA (fail-closed)', () => {
      expect(() =>
        assertSafeTestDatabase({ TEST_DATABASE_URL: 'bozuk-adres', DATABASE_URL: NEON }, { requireDistinct: true }),
      ).toThrow(/çözümlenemedi/);
    });

    it('TEST_DATABASE_URL yok + tanınmayan uzak host → HATA', () => {
      expect(() => assertSafeTestDatabase({ DATABASE_URL: 'postgresql://app:pw@postgres:5432/menti' })).toThrow(
        /bu makinedeki/,
      );
      expect(() => assertSafeTestDatabase({ DATABASE_URL: 'postgresql://u:p@db.example.com/x' })).toThrow(
        /bu makinedeki/,
      );
    });

    it('TEST_DATABASE_URL yok + 127.0.0.1 → izin', () => {
      const loop = 'postgresql://postgres:postgres@127.0.0.1:5432/menti_mentor_test';
      expect(assertSafeTestDatabase({ DATABASE_URL: loop })).toBe(loop);
    });
  });
});

