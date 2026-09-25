/**
 * KR-13 — elle çalıştırılan probe betikleri (cron-probe.ts, k1-probe.ts) için veritabanı kilidi.
 *
 * NEDEN: probe betikleri gerçek temizlik işlevlerini çağırır (ör. runDraftTenantCleanup: 96 saati
 * geçen TÜM taslak kurumları kullanıcılarıyla birlikte siler). `.env` canlı veritabanını gösterebilir
 * (CLAUDE.md "CANLI = LOKAL AYNI DB"). Bu yüzden probe'lar YALNIZ açıkça verilmiş, canlıdan farklı
 * bir TEST_DATABASE_URL ile çalışır — `.env`'deki DATABASE_URL'e düşmek YOK.
 */
import { assertSafeTestDatabase, type TestDbEnv } from './assertTestDatabase.js';

/** Güvenli probe veritabanı adresini döndürür; güvensizse hata fırlatır. Saf fonksiyon. */
export function resolveProbeDatabaseUrl(env: TestDbEnv): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (!explicit) {
    throw new Error(
      'PROBE KİLİDİ: TEST_DATABASE_URL tanımlı değil. Probe betikleri gerçek temizlik çalıştırır; ' +
        'yalnız ayrı bir test veritabanında çalıştırılabilir (.env\'deki DATABASE_URL kullanılmaz).',
    );
  }
  return assertSafeTestDatabase({ TEST_DATABASE_URL: explicit, DATABASE_URL: env.DATABASE_URL }, { requireDistinct: true });
}

/**
 * Probe başlangıcında çağrılır: kilidi uygular ve süreçteki DATABASE_URL'i test veritabanına
 * yönlendirir (dinamik import edilen config/db zinciri bu değeri görür).
 */
export function lockProbeToTestDatabase(): string {
  const url = resolveProbeDatabaseUrl(process.env);
  process.env['DATABASE_URL'] = url;
  return url;
}
