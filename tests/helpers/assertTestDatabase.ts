/**
 * Fail-safe: testlerin canlı/üretim veritabanını (Neon vb.) yanlışlıkla
 * silmesini önler.
 *
 * NEDEN: cleanDb() her test bloğunda `TRUNCATE ... CASCADE` çalıştırır. Eğer
 * TEST_DATABASE_URL ayarlanmaz ve testler .env'deki gerçek DATABASE_URL'e
 * (Neon cloud) düşerse, her `npm run verify` gerçek veriyi SİLER. Bu guard,
 * DB'ye bağlanmadan / migrate / truncate çalışmadan ÖNCE devreye girer.
 *
 * KURAL:
 *   1. TEST_DATABASE_URL açıkça ayarlıysa → operatör bilinçli seçmiştir
 *      (ör. ayrı bir Neon test branch'i). İzin ver — ancak (3)'e bak.
 *   2. TEST_DATABASE_URL yoksa ve hedef DB canlı bir host'a benziyorsa
 *      (Neon / RDS / Supabase) → DUR. İzole DB için .env.test'e
 *      TEST_DATABASE_URL ekleyin (bkz. .env.test.example).
 *   3. requireDistinct: TEST_DATABASE_URL, gerçek DATABASE_URL ile birebir
 *      AYNI ve canlı bir host ise → izolasyon yok demektir, yine DUR.
 *
 * CI (ephemeral postgres service container, localhost) bu kuraldan etkilenmez:
 * localhost canlı host desenine uymaz.
 */

// Canlı/yönetilen DB sağlayıcı host desenleri — bunlara TEST_DATABASE_URL olmadan dokunmak yasak.
const LIVE_DB_HOST_PATTERN = /neon\.tech|\.rds\.amazonaws\.com|supabase\.co|\.render\.com/i;

export interface TestDbEnv {
  TEST_DATABASE_URL?: string | undefined;
  DATABASE_URL?: string | undefined;
}

export interface AssertOptions {
  /** TEST_DATABASE_URL, canlı DATABASE_URL ile aynıysa da reddet (globalSetup için true). */
  requireDistinct?: boolean;
}

const SETUP_HINT =
  'İzole bir test veritabanı için .env.test dosyasına TEST_DATABASE_URL ekleyin ' +
  '(örnek: .env.test.example). Ayrıntı: tests/helpers/assertTestDatabase.ts';

/**
 * Güvenli test DB URL'ini döndürür; güvensizse hata fırlatır.
 * Saf fonksiyon — yan etkisi yok, birim testi kolaydır.
 */
export function assertSafeTestDatabase(env: TestDbEnv, opts: AssertOptions = {}): string {
  const explicit = env.TEST_DATABASE_URL?.trim() || undefined;
  const fallback = env.DATABASE_URL?.trim() || undefined;
  const target = explicit ?? fallback;

  if (!target) {
    throw new Error(
      `Test veritabanı yapılandırılmamış: TEST_DATABASE_URL veya DATABASE_URL tanımlı değil.\n${SETUP_HINT}`,
    );
  }

  const targetIsLive = LIVE_DB_HOST_PATTERN.test(target);

  // (2) Açık test DB yok + hedef canlı → veri kaybı riski, DUR.
  if (!explicit && targetIsLive) {
    throw new Error(
      'GÜVENLİK KİLİDİ: TEST_DATABASE_URL tanımlı değil ve DATABASE_URL canlı bir ' +
        'veritabanına (Neon/RDS) işaret ediyor. Testler TRUNCATE ... CASCADE çalıştırır ' +
        `ve bu GERÇEK VERİYİ SİLER.\n${SETUP_HINT}`,
    );
  }

  // (3) Açık test DB var ama gerçek DATABASE_URL ile birebir aynı ve canlı → izolasyon yok, DUR.
  if (opts.requireDistinct && explicit && targetIsLive && explicit === fallback) {
    throw new Error(
      'GÜVENLİK KİLİDİ: TEST_DATABASE_URL, canlı DATABASE_URL ile aynı değere sahip. ' +
        'Testler için AYRI bir veritabanı (ör. Neon test branch) kullanın; aksi halde ' +
        `gerçek veri TRUNCATE ile silinir.\n${SETUP_HINT}`,
    );
  }

  return target;
}
