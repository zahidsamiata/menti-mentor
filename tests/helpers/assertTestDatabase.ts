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
 *   2. TEST_DATABASE_URL yoksa yalnız yerel (loopback) veritabanına izin
 *      verilir; canlı ya da TANINMAYAN uzak host → DUR. İzole DB için
 *      .env.test'e TEST_DATABASE_URL ekleyin (bkz. .env.test.example).
 *   3. requireDistinct: TEST_DATABASE_URL, gerçek DATABASE_URL ile AYNI
 *      veritabanını gösteriyorsa (metin farklı olsa bile: Neon "-pooler"
 *      adresi, büyük/küçük harf, varsayılan port, sorgu parametreleri) ve
 *      yerel değilse → izolasyon yok demektir, yine DUR.
 *
 * CI (ephemeral postgres service container, localhost) bu kuraldan etkilenmez:
 * localhost canlı host desenine uymaz.
 */

// Canlı/yönetilen DB sağlayıcı host desenleri — bunlara TEST_DATABASE_URL olmadan dokunmak yasak.
const LIVE_DB_HOST_PATTERN = /neon\.tech|\.rds\.amazonaws\.com|supabase\.co|\.render\.com/i;

// TEST_DATABASE_URL olmadan izin verilen tek hedef: bu makinedeki veritabanı. Docker servis adları
// (ör. `postgres`) BİLEREK dışarıda — canlı docker-compose veritabanı da o adla çağrılır.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const DEFAULT_PG_PORT = '5432';

function parseDbUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function isLoopback(url: string): boolean {
  const parsed = parseDbUrl(url);
  return parsed !== undefined && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Aynı fiziksel veritabanının farklı yazılışlarını tek kimliğe indirger: host (Neon bağlantı
 * havuzu adresi `ep-x-pooler.…` ile doğrudan adres `ep-x.…` aynı veritabanıdır) + port + veritabanı adı.
 * Kullanıcı adı, şifre ve sorgu parametreleri kimliği değiştirmez. Çözümlenemezse undefined.
 */
export function databaseIdentity(url: string): string | undefined {
  const parsed = parseDbUrl(url);
  if (!parsed || !parsed.hostname) return undefined;
  const [firstLabel = '', ...rest] = parsed.hostname.toLowerCase().split('.');
  const host = [firstLabel.replace(/-pooler$/, ''), ...rest].join('.');
  const port = parsed.port || DEFAULT_PG_PORT;
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  return `${host}:${port}/${dbName}`;
}

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

  // (2b) Açık test DB yok + hedef yerel değil (tanınmayan uzak host) → varsayılan RET.
  if (!explicit && !isLoopback(target)) {
    throw new Error(
      'GÜVENLİK KİLİDİ: TEST_DATABASE_URL tanımlı değil ve DATABASE_URL bu makinedeki bir ' +
        'veritabanını göstermiyor. Uzak bir veritabanı canlı olabilir; testler TRUNCATE ... CASCADE ' +
        `çalıştırır.\n${SETUP_HINT}`,
    );
  }

  // (3) Açık test DB, gerçek DATABASE_URL ile aynı veritabanını gösteriyor ve yerel değil → izolasyon yok, DUR.
  if (opts.requireDistinct && explicit && fallback && !isLoopback(explicit)) {
    const explicitId = databaseIdentity(explicit);
    const fallbackId = databaseIdentity(fallback);
    const sameDatabase = explicitId === undefined || fallbackId === undefined || explicitId === fallbackId;
    if (sameDatabase) {
      throw new Error(
        'GÜVENLİK KİLİDİ: TEST_DATABASE_URL, gerçek DATABASE_URL ile aynı veritabanını gösteriyor ' +
          '(aynı değere ya da aynı sunucu + veritabanı adına sahip; Neon "-pooler" adresi de aynı sayılır) ' +
          'ya da adres çözümlenemedi. Testler için AYRI bir veritabanı (ör. Neon test branch) kullanın; ' +
          `aksi halde gerçek veri TRUNCATE ile silinir.\n${SETUP_HINT}`,
      );
    }
  }

  return target;
}
