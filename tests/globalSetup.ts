/**
 * Global test setup — tüm test suite'i başlamadan önce bir kez çalışır.
 *
 * Görevler:
 *  1. TEST_DATABASE_URL'in tanımlı olduğunu doğrular
 *  2. Neon serverless soğuk başlatmasını geç (SELECT 1 warm-up + retry)
 *  3. Prisma migrate deploy ile test DB schema'sını uygular
 *
 * Tasarım kararı: Migration'ı her test run'da uyguluyoruz (idempotent).
 * Production migration'ları hiçbir zaman dev/test DB'ye uygulanmaz;
 * bu nedenle DATABASE_URL yerine TEST_DATABASE_URL zorunludur.
 *
 * Neon soğuk başlatma notu: serverless Neon instance'ı uyku modundayken
 * prisma migrate deploy P1002 (Can't reach database) fırlatabilir.
 * waitForDatabase(), migrate deploy'dan önce bağlantıyı garantiye alır;
 * böylece deploy adımında çıkan hata gerçek migration hatasıdır (yutulmaz).
 */

import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// globalSetup setupFiles'tan önce çalışır; her iki env dosyası da yüklenmeli.
// Önce .env (ana konfigürasyon), sonra .env.test (override) yükle.
loadEnv({ path: '.env' });
loadEnv({ path: '.env.test', override: true });

const WARM_UP_MAX    = 5;    // SELECT 1 için max deneme
const WARM_UP_DELAY  = 3000; // SELECT 1 denemeleri arası (ms)
const DEPLOY_MAX     = 3;    // migrate deploy için max deneme
const DEPLOY_DELAY   = 4000; // deploy denemeleri arası (ms)

/**
 * Neon serverless soğuk başlatmasını bekler.
 * Başarılı SELECT 1 dönene kadar WARM_UP_MAX kez yeniden dener.
 * Son denemede de başarısız olursa hatayı üst katmana iletir (yutmaz).
 * DATABASE_URL çağrılmadan önce process.env'de set edilmiş olmalıdır.
 */
async function waitForDatabase(): Promise<void> {
  const client = new PrismaClient();
  try {
    for (let attempt = 1; attempt <= WARM_UP_MAX; attempt++) {
      try {
        await client.$queryRaw`SELECT 1`;
        if (attempt > 1) {
          console.log(`[globalSetup] Neon aktif — ${attempt}. denemede bağlantı kuruldu.`);
        }
        return;
      } catch (err) {
        if (attempt === WARM_UP_MAX) throw err; // gerçek hata — yutma
        const hint = String(err).split('\n')[0].slice(0, 100);
        console.log(
          `[globalSetup] Neon soğuk başlatma bekleniyor ` +
          `(deneme ${attempt}/${WARM_UP_MAX}): ${hint}`,
        );
        await new Promise<void>(r => setTimeout(r, WARM_UP_DELAY));
      }
    }
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/**
 * migrate deploy'u retry döngüsüne alır.
 * Warm-up geçtikten sonra Neon'un yeni TCP bağlantısı kurarken oluşan
 * race condition'ı (P1002) absorbe eder.
 * Gerçek migration hatası tüm denemelerde tekrar eder → son denemede fırlatılır (yutulmaz).
 */
async function migrateWithRetry(env: NodeJS.ProcessEnv): Promise<void> {
  for (let attempt = 1; attempt <= DEPLOY_MAX; attempt++) {
    try {
      execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
      return;
    } catch (err) {
      if (attempt === DEPLOY_MAX) throw err; // son deneme — yutma
      console.log(
        `[globalSetup] migrate deploy başarısız (deneme ${attempt}/${DEPLOY_MAX}), ` +
        `${DEPLOY_DELAY}ms sonra yeniden deneniyor…`,
      );
      await new Promise<void>(r => setTimeout(r, DEPLOY_DELAY));
    }
  }
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

  // DATABASE_URL'i erkenden set et — waitForDatabase yeni bir PrismaClient oluşturur
  process.env['DATABASE_URL'] = testDbUrl;
  process.env['TEST_DATABASE_URL'] = testDbUrl;

  // Neon uyanana kadar bekle; bu başarılıysa bağlantı garantilenmiştir.
  await waitForDatabase();

  // Her ortamda (Neon dahil) migration'ları uygula; idempotent — zaten güncel tabloları atlar.
  // migrateWithRetry: warm-up sonrası oluşan kısa-süreli TCP race condition'larını absorbe eder.
  console.log('[globalSetup] DB migration uygulanıyor…');
  await migrateWithRetry({ ...process.env, DATABASE_URL: testDbUrl });
  console.log('[globalSetup] Migration tamamlandı.');
}

export async function teardown(): Promise<void> {
  // singleFork modunda testPrisma global teardown'da kapatılır
  const { disconnectDb } = await import('./helpers/db.js');
  await disconnectDb();
}
