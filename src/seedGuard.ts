/**
 * Yıkıcı seed koruması (prisma/seed.ts).
 *
 * NEDEN: prisma/seed.ts idempotent olmak için çalışmaya başlarken tabloları toplu
 * temizler. Bu script `npm run seed` ile ve package.json'daki `prisma.seed` ayarı
 * yüzünden `prisma migrate reset` / `prisma db seed` ile de tetiklenebilir. Lokal
 * geliştirme ortamı canlıyla AYNI veritabanını paylaşabildiği için (CLAUDE.md
 * "CANLI = LOKAL AYNI DB") tek bir yanlış komut gerçek veriyi silebilir.
 *
 * KURAL (fail-closed — üç şart birden sağlanmazsa seed ÇALIŞMAZ):
 *   1. NODE_ENV 'production' olmayacak.
 *   2. DATABASE_URL yalnız yerel bir host'u gösterecek (localhost / 127.0.0.1 / ::1).
 *      Bilinmeyen her host (Neon, docker-compose `postgres`, uzak IP…) reddedilir.
 *   3. SEED_ALLOW_DESTRUCTIVE açıkça SEED_CONFIRM_VALUE değerine eşit olacak.
 */

export const SEED_CONFIRM_VALUE = 'evet-yerel-veriyi-sil';

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface SeedGuardEnv {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  SEED_ALLOW_DESTRUCTIVE?: string | undefined;
}

export type LocalDbHostCheck =
  | { ok: true; host: string }
  | { ok: false; reason: 'missing' | 'unparseable' | 'host-param' }
  | { ok: false; reason: 'not-local'; host: string };

/**
 * DATABASE_URL yalnız yerel bir host'u mu gösteriyor? Saf fonksiyon; fail-closed (şüphede ok:false).
 * Seed kilidi (KR-01) ve tehlikeli DB komut kapısı (AJ-96, src/dangerousDbGuard.ts) aynı kuralı kullanır.
 */
export function checkLocalDatabaseUrl(rawUrl: string | undefined): LocalDbHostCheck {
  const url = rawUrl?.trim();
  if (!url) return { ok: false, reason: 'missing' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  const host = parsed.hostname.toLowerCase();

  // Postgres bağlantı adresi `?host=` parametresiyle asıl sunucuyu ezebilir → hostname tek başına güvenilmez.
  if (parsed.searchParams.has('host')) return { ok: false, reason: 'host-param' };

  if (!LOCAL_DB_HOSTS.has(host)) return { ok: false, reason: 'not-local', host };

  return { ok: true, host };
}

/** Seed çalışabilirse hedef host'u döndürür; çalışamazsa Türkçe gerekçeyle hata fırlatır. Saf fonksiyon. */
export function assertSeedAllowed(env: SeedGuardEnv): string {
  if (env.NODE_ENV === 'production') {
    throw new Error('SEED KİLİDİ: NODE_ENV=production iken seed çalıştırılamaz.');
  }

  const target = checkLocalDatabaseUrl(env.DATABASE_URL);
  if (!target.ok) {
    switch (target.reason) {
      case 'missing':
        throw new Error('SEED KİLİDİ: DATABASE_URL tanımlı değil.');
      case 'unparseable':
        throw new Error('SEED KİLİDİ: DATABASE_URL çözümlenemedi; seed çalıştırılmadı.');
      case 'host-param':
        throw new Error('SEED KİLİDİ: DATABASE_URL "host" parametresi içeriyor; hedef doğrulanamadı, seed çalıştırılmadı.');
      case 'not-local':
        throw new Error(
          `SEED KİLİDİ: seed yalnız yerel veritabanında çalışır (localhost / 127.0.0.1 / ::1). ` +
            `Hedef host "${target.host}" yerel değil; seed çalıştırılmadı.`,
        );
    }
  }

  if (env.SEED_ALLOW_DESTRUCTIVE !== SEED_CONFIRM_VALUE) {
    throw new Error(
      'SEED KİLİDİ: seed mevcut verinin bir kısmını siler. Bilerek çalıştırmak için ' +
        `SEED_ALLOW_DESTRUCTIVE=${SEED_CONFIRM_VALUE} ortam değişkenini ayarlayın.`,
    );
  }

  return target.host;
}
