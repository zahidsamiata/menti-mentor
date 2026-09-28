/**
 * AJ-57 — tehlikeli veritabanı komutları için açık onay kapısı (saf mantık).
 *
 * NEDEN: `prisma migrate dev` şema sapmasında (drift) veritabanını SIFIRLAMAYI önerir; sıfırlama
 * ve ardından package.json'daki `prisma.seed` ayarı yüzünden `prisma/seed.ts` kendiliğinden koşar
 * ve toplu deleteMany() yapar. Lokal geliştirme ortamı canlıyla AYNI veritabanını paylaşabildiği
 * için (CLAUDE.md § CANLI = LOKAL AYNI DB) README'deki bir kurulum adımını izleyen biri — insan ya
 * da ajan — canlı veriyi silebilir.
 *
 * KURAL (fail-closed): bir işlem yalnız `MENTI_TEHLIKELI_DB_ONAY` ortam değişkeni o işlemin adına
 * TAM eşitse çalıştırılır. Aksi hâlde Türkçe gerekçe basılır, komut ÇAĞRILMAZ, sıfır olmayan kodla
 * çıkılır.
 *
 * AJ-96: onay tek başına yetmez — `requiresLocalDatabase` işaretli işlem (migrate-dev) ayrıca
 * DATABASE_URL yerel host'u göstermiyorsa reddedilir (kural src/seedGuard.ts ile ortak:
 * checkLocalDatabaseUrl). Onay değişkeninin adı ret mesajında KALIR: repo açık, ad zaten README'de;
 * gizlemek koruma sağlamaz, asıl koruma host şartıdır.
 *
 * Katmanlar:
 *   - scripts/db-guard.ts             → npm betikleri ve `prisma.seed` bu CLI'dan geçer.
 *   - prisma/seed-approval-gate.ts    → `tsx prisma/seed.ts` doğrudan çalıştırılsa da ilk import
 *                                       olarak bu kontrolü yapar (DB istemcisi oluşmadan).
 *   - src/seedGuard.ts (KR-01)        → seed.ts içinde ayrıca yerel host + SEED_ALLOW_DESTRUCTIVE ister.
 */

import { checkLocalDatabaseUrl, type LocalDbHostCheck } from './seedGuard.js';

export const DANGEROUS_DB_APPROVAL_ENV = 'MENTI_TEHLIKELI_DB_ONAY';

/** Onay reddedildiğinde (ya da bilinmeyen işlemde) CLI'ın çıkış kodu. */
export const DB_GUARD_REFUSED_EXIT_CODE = 1;

export interface DangerousDbOperation {
  /** Çalıştırılacak program (PATH üzerinden). */
  command: string;
  /** Programın sabit argümanları; kullanıcının ek argümanları sona eklenir. */
  args: readonly string[];
  /** Neden tehlikeli — ret mesajında gösterilir. */
  risk: string;
  /** Bunun yerine ne yapılmalı — ret mesajında gösterilir. */
  saferPath: string;
  /**
   * true → onay olsa bile DATABASE_URL yerel host değilse ret (AJ-96). seed'de gerekmez:
   * prisma/seed.ts kendi içinde aynı şartı ayrıca uygular (src/seedGuard.ts, KR-01).
   */
  requiresLocalDatabase?: boolean;
}

const LIVE_DB_WARNING =
  'CANLI = LOKAL AYNI DB: lokal .env canlı veritabanını gösteriyor olabilir (CLAUDE.md § CANLI = LOKAL AYNI DB). ' +
  'Bu komut orada çalışırsa gerçek kullanıcı verisi kaybolur.';

export const DANGEROUS_DB_OPERATIONS: Readonly<Record<string, DangerousDbOperation>> = Object.freeze({
  seed: {
    command: 'npx',
    args: ['tsx', 'prisma/seed.ts'],
    risk:
      'prisma/seed.ts çalışmaya başlarken toplu deleteMany() yapar (userResponse, feedback, meeting, ' +
      'matchRequest, club, tenant, user … siler).',
    saferPath:
      'Seed yerine, ilgili KARAR "evet" + tarihli yedek sonrası yalnız gereken alt komutu kullanın: ' +
      '`npm run seed:certification`, `npm run seed:learning-journey`, `npm run seed:test-tenant` (varsayılan dry-run). ' +
      'Ayrıntı: README § Kurulum adım 4.',
  },
  'migrate-dev': {
    command: 'npx',
    args: ['prisma', 'migrate', 'dev'],
    risk:
      '`prisma migrate dev` şema sapmasında veritabanını SIFIRLAMAYI önerir; sıfırlama tüm tabloları boşaltır ' +
      've ardından prisma/seed.ts kendiliğinden koşar.',
    saferPath:
      'Bekleyen migration durumunu görmek için (salt-okuma): `npm run prisma:migrate:status`. ' +
      'Şema değişikliği için CLAUDE.md § Migration Kuralı: SQL\'i `IF NOT EXISTS` ile yazın → ' +
      '`npx prisma db execute --file <migration.sql> --schema prisma/schema.prisma` → ' +
      '`npx prisma migrate resolve --applied <migration-adı>` — yalnız ilgili KARAR "evet" + tarihli yedek sonrası. ' +
      '`prisma db push --accept-data-loss` YASAKTIR.',
    requiresLocalDatabase: true,
  },
});

export type DbGuardDecision =
  | { allowed: true; operation: DangerousDbOperation }
  | { allowed: false; message: string };

export interface DbGuardEnv {
  [key: string]: string | undefined;
}

function listOperations(): string {
  return Object.keys(DANGEROUS_DB_OPERATIONS).join(', ');
}

function describeNonLocalTarget(target: Exclude<LocalDbHostCheck, { ok: true }>): string {
  switch (target.reason) {
    case 'missing':
      return 'DATABASE_URL tanımlı değil; hedef doğrulanamadı.';
    case 'unparseable':
      return 'DATABASE_URL çözümlenemedi; hedef doğrulanamadı.';
    case 'host-param':
      return 'DATABASE_URL "host" parametresi içeriyor; hedef doğrulanamadı.';
    case 'not-local':
      return `hedef host "${target.host}" yerel değil.`;
  }
}

/** İşlem adının ve onay değişkeninin durumuna göre karar verir. Saf fonksiyon: hiçbir şey çalıştırmaz. */
export function checkDangerousDbApproval(operationName: string | undefined, env: DbGuardEnv): DbGuardDecision {
  // hasOwn: "constructor" gibi prototip adları işlem sayılmasın.
  const operation =
    operationName && Object.hasOwn(DANGEROUS_DB_OPERATIONS, operationName)
      ? DANGEROUS_DB_OPERATIONS[operationName]
      : undefined;
  if (!operationName || !operation) {
    return {
      allowed: false,
      message: `DB KİLİDİ: bilinmeyen işlem "${operationName ?? ''}". Tanımlı işlemler: ${listOperations()}.`,
    };
  }

  if (env[DANGEROUS_DB_APPROVAL_ENV] === operationName) {
    if (operation.requiresLocalDatabase) {
      const target = checkLocalDatabaseUrl(env['DATABASE_URL']);
      if (!target.ok) {
        return {
          allowed: false,
          message: [
            `DB KİLİDİ: "${operationName}" çalıştırılmadı — onay verildi ama ${describeNonLocalTarget(target)}`,
            'Onay yalnız yerel veritabanında (localhost / 127.0.0.1 / ::1) geçerlidir.',
            LIVE_DB_WARNING,
            `Güvenli yol: ${operation.saferPath}`,
          ].join('\n'),
        };
      }
    }
    return { allowed: true, operation };
  }

  return {
    allowed: false,
    message: [
      `DB KİLİDİ: "${operationName}" çalıştırılmadı.`,
      `Neden tehlikeli: ${operation.risk}`,
      LIVE_DB_WARNING,
      `Güvenli yol: ${operation.saferPath}`,
      `Bilerek, izole/geçici bir veritabanında çalıştırmak için` +
        (operation.requiresLocalDatabase ? ' (yalnız yerel host — localhost / 127.0.0.1 / ::1)' : ' (host\'u doğrulayarak)') +
        ': ' +
        `${DANGEROUS_DB_APPROVAL_ENV}=${operationName} ortam değişkenini ayarlayın.`,
    ].join('\n'),
  };
}

/** Komutu çalıştırıp çıkış kodunu döndüren çalıştırıcı (testte sahtesi enjekte edilir). */
export type DbCommandRunner = (command: string, args: readonly string[], env: DbGuardEnv) => number;

export interface DbGuardDeps {
  run: DbCommandRunner;
  logError: (message: string) => void;
}

/**
 * CLI akışı: argv[0] işlem adı, kalanı komuta aynen eklenir (ör. `--name x`).
 * Onay yoksa çalıştırıcı ÇAĞRILMAZ ve DB_GUARD_REFUSED_EXIT_CODE döner.
 */
export function runDangerousDbCommand(argv: readonly string[], env: DbGuardEnv, deps: DbGuardDeps): number {
  const [operationName, ...extraArgs] = argv;
  const decision = checkDangerousDbApproval(operationName, env);
  if (!decision.allowed) {
    deps.logError(decision.message);
    return DB_GUARD_REFUSED_EXIT_CODE;
  }
  return deps.run(decision.operation.command, [...decision.operation.args, ...extraArgs], env);
}
