/**
 * Global test setup — tüm test suite'i başlamadan önce bir kez çalışır.
 *
 * Görevler:
 *  1. TEST_DATABASE_URL'in tanımlı olduğunu doğrular
 *  2. Prisma migrate deploy ile test DB schema'sını uygular
 *
 * Tasarım kararı: Migration'ı her test run'da uyguluyoruz (idempotent).
 * Production migration'ları hiçbir zaman dev/test DB'ye uygulanmaz;
 * bu nedenle DATABASE_URL yerine TEST_DATABASE_URL zorunludur.
 */

import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

// globalSetup setupFiles'tan önce çalışır; her iki env dosyası da yüklenmeli.
// Önce .env (ana konfigürasyon), sonra .env.test (override) yükle.
loadEnv({ path: '.env' });
loadEnv({ path: '.env.test', override: true });

function isLocalDatabase(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

export async function setup(): Promise<void> {
  // TEST_DATABASE_URL yoksa ana DATABASE_URL'i test için kullan (Neon cloud senaryosu)
  const testDbUrl = process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!testDbUrl) {
    throw new Error(
      'TEST_DATABASE_URL veya DATABASE_URL tanımlı değil.\n' +
      '.env.test dosyasına TEST_DATABASE_URL ekleyin veya .env içindeki DATABASE_URL\'i yapılandırın.',
    );
  }

  // Her ortamda (Neon dahil) migration'ları uygula; idempotent — zaten güncel tabloları atlar.
  console.log('[globalSetup] DB migration uygulanıyor…');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'inherit',
  });
  console.log('[globalSetup] Migration tamamlandı.');

  // Her iki durumda da DATABASE_URL'i test DB'sine yönlendir
  process.env['DATABASE_URL'] = testDbUrl;
  process.env['TEST_DATABASE_URL'] = testDbUrl;
}

export async function teardown(): Promise<void> {
  // singleFork modunda testPrisma global teardown'da kapatılır
  const { disconnectDb } = await import('./helpers/db.js');
  await disconnectDb();
}
