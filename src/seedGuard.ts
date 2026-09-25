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

/** Seed çalışabilirse hedef host'u döndürür; çalışamazsa Türkçe gerekçeyle hata fırlatır. Saf fonksiyon. */
export function assertSeedAllowed(env: SeedGuardEnv): string {
  if (env.NODE_ENV === 'production') {
    throw new Error('SEED KİLİDİ: NODE_ENV=production iken seed çalıştırılamaz.');
  }

  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('SEED KİLİDİ: DATABASE_URL tanımlı değil.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SEED KİLİDİ: DATABASE_URL çözümlenemedi; seed çalıştırılmadı.');
  }
  const host = parsed.hostname.toLowerCase();

  // Postgres bağlantı adresi `?host=` parametresiyle asıl sunucuyu ezebilir → hostname tek başına güvenilmez.
  if (parsed.searchParams.has('host')) {
    throw new Error('SEED KİLİDİ: DATABASE_URL "host" parametresi içeriyor; hedef doğrulanamadı, seed çalıştırılmadı.');
  }

  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `SEED KİLİDİ: seed yalnız yerel veritabanında çalışır (localhost / 127.0.0.1 / ::1). ` +
        `Hedef host "${host}" yerel değil; seed çalıştırılmadı.`,
    );
  }

  if (env.SEED_ALLOW_DESTRUCTIVE !== SEED_CONFIRM_VALUE) {
    throw new Error(
      'SEED KİLİDİ: seed mevcut verinin bir kısmını siler. Bilerek çalıştırmak için ' +
        `SEED_ALLOW_DESTRUCTIVE=${SEED_CONFIRM_VALUE} ortam değişkenini ayarlayın.`,
    );
  }

  return host;
}
