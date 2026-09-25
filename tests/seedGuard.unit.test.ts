/**
 * KR-01 — yıkıcı seed koruması (src/seedGuard.ts) birim testleri.
 * Saf fonksiyon: DB'ye bağlanmaz.
 */
import { describe, it, expect } from 'vitest';
import { assertSeedAllowed, SEED_CONFIRM_VALUE } from '../src/seedGuard.js';

const LOCAL = 'postgresql://user:pass@localhost:5432/menti_dev';

describe('assertSeedAllowed', () => {
  it('yerel host + açık onay + production değil → izin verir', () => {
    expect(assertSeedAllowed({ DATABASE_URL: LOCAL, SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE })).toBe('localhost');
    expect(
      assertSeedAllowed({
        DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
        SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE,
        NODE_ENV: 'development',
      }),
    ).toBe('127.0.0.1');
  });

  it('onay değişkeni yoksa ya da yanlışsa reddeder', () => {
    expect(() => assertSeedAllowed({ DATABASE_URL: LOCAL })).toThrow(/SEED KİLİDİ/);
    expect(() => assertSeedAllowed({ DATABASE_URL: LOCAL, SEED_ALLOW_DESTRUCTIVE: 'true' })).toThrow(/SEED KİLİDİ/);
    expect(() => assertSeedAllowed({ DATABASE_URL: LOCAL, SEED_ALLOW_DESTRUCTIVE: 'evet' })).toThrow(/SEED KİLİDİ/);
  });

  it('yönetilen / uzak veritabanı host’unu onay olsa bile reddeder', () => {
    const remote = [
      'postgresql://u:p@ep-example-123.eu-west-2.aws.neon.tech/neondb?sslmode=require',
      'postgresql://u:p@ep-example-123-pooler.eu-west-2.aws.neon.tech/neondb',
      'postgresql://u:p@postgres:5432/menti', // docker-compose prod servis adı
      'postgresql://u:p@10.0.0.5:5432/menti',
      'postgresql://u:p@db.example.com:5432/menti',
    ];
    for (const DATABASE_URL of remote) {
      expect(() => assertSeedAllowed({ DATABASE_URL, SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE })).toThrow(
        /yerel değil/,
      );
    }
  });

  it('IPv6 yerel adres kabul edilir; yerel görünen ama başka hedefi gösteren adresler reddedilir', () => {
    expect(
      assertSeedAllowed({ DATABASE_URL: 'postgresql://u:p@[::1]:5432/db', SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE }),
    ).toBe('[::1]');
    const tricky = [
      'postgresql://u:p@localhost:5432/db?host=ep-example.eu-west-2.aws.neon.tech',
      'postgresql://localhost:p@db.example.com:5432/db',
      'postgresql://u:p@localhost.example.com:5432/db',
    ];
    for (const DATABASE_URL of tricky) {
      expect(() => assertSeedAllowed({ DATABASE_URL, SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE })).toThrow(/SEED KİLİDİ/);
    }
  });

  it('NODE_ENV=production iken yerel host ve onay olsa bile reddeder', () => {
    expect(() =>
      assertSeedAllowed({ DATABASE_URL: LOCAL, SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE, NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });

  it('DATABASE_URL yoksa ya da çözümlenemiyorsa reddeder', () => {
    expect(() => assertSeedAllowed({ SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE })).toThrow(/tanımlı değil/);
    expect(() => assertSeedAllowed({ DATABASE_URL: 'bozuk-adres', SEED_ALLOW_DESTRUCTIVE: SEED_CONFIRM_VALUE })).toThrow(
      /çözümlenemedi/,
    );
  });
});
