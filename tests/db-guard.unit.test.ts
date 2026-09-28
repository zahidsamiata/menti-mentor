/**
 * AJ-57 — tehlikeli DB komutları (seed, migrate dev) için açık onay kapısı.
 *
 * Neden: `prisma migrate dev` drift'te DB'yi sıfırlamayı önerir, sıfırlama sonrası `prisma.seed`
 * ayarıyla prisma/seed.ts (toplu deleteMany) kendiliğinden koşar; canlı = lokal aynı DB.
 * Bu dosya dört katmanı kilitler:
 *   (a) saf karar fonksiyonu + CLI akışı (enjekte çalıştırıcı — gerçek komut ÇALIŞMAZ),
 *   (b) package.json: seed / prisma:migrate / prisma.seed koruma betiğinden geçer,
 *   (c) prisma/seed.ts ilk import olarak onay kapısını yükler,
 *   (d) onay kapısı modülü onaysız süreçte sıfır olmayan kodla çıkar (seed.ts KOŞULMAZ; kapı
 *       yalnız saf modülü import eder, DB istemcisi oluşturmaz).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  checkDangerousDbApproval,
  runDangerousDbCommand,
  DANGEROUS_DB_APPROVAL_ENV,
  DB_GUARD_REFUSED_EXIT_CODE,
  type DbGuardEnv,
} from '../src/dangerousDbGuard.js';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOCAL_DB_URL = 'postgresql://u:p@localhost:5432/menti_dev';

function fakeDeps(exitCode = 0) {
  return { run: vi.fn(() => exitCode), logError: vi.fn() };
}

describe('AJ-57 · checkDangerousDbApproval / runDangerousDbCommand', () => {
  it('onay yok → seed reddedilir, çalıştırıcı ÇAĞRILMAZ, çıkış kodu ≠ 0', () => {
    const deps = fakeDeps();
    const code = runDangerousDbCommand(['seed'], {}, deps);
    expect(code).toBe(DB_GUARD_REFUSED_EXIT_CODE);
    expect(code).not.toBe(0);
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.logError).toHaveBeenCalledTimes(1);
  });

  it('onay yok → migrate-dev reddedilir, çalıştırıcı ÇAĞRILMAZ', () => {
    const deps = fakeDeps();
    expect(runDangerousDbCommand(['migrate-dev', '--name', 'x'], {}, deps)).toBe(DB_GUARD_REFUSED_EXIT_CODE);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('yanlış onay değeri → ret (tam eşleşme şartı)', () => {
    const wrong: Array<[string, string]> = [
      ['seed', 'evet'],
      ['seed', 'true'],
      ['seed', '1'],
      ['seed', 'SEED'],
      ['seed', ' seed'],
      ['seed', 'migrate-dev'],
      ['migrate-dev', 'seed'],
      ['migrate-dev', 'migrate'],
      ['migrate-dev', ''],
    ];
    for (const [operation, value] of wrong) {
      const deps = fakeDeps();
      const code = runDangerousDbCommand([operation], { [DANGEROUS_DB_APPROVAL_ENV]: value }, deps);
      expect(code, `${operation} / "${value}"`).toBe(DB_GUARD_REFUSED_EXIT_CODE);
      expect(deps.run).not.toHaveBeenCalled();
    }
  });

  it('doğru onay → izin; seed gerçek komut yerine enjekte çalıştırıcıya gider', () => {
    const deps = fakeDeps(0);
    const env: DbGuardEnv = { [DANGEROUS_DB_APPROVAL_ENV]: 'seed' };
    expect(runDangerousDbCommand(['seed'], env, deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledWith('npx', ['tsx', 'prisma/seed.ts'], env);
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it('doğru onay → migrate-dev ek argümanları aktarır, alt sürecin çıkış kodunu döndürür', () => {
    const deps = fakeDeps(7);
    // AJ-96: migrate-dev onayı yalnız yerel host'ta geçer → izin senaryosu yerel adresle kurulur.
    const env: DbGuardEnv = { [DANGEROUS_DB_APPROVAL_ENV]: 'migrate-dev', DATABASE_URL: LOCAL_DB_URL };
    expect(runDangerousDbCommand(['migrate-dev', '--name', 'ekle'], env, deps)).toBe(7);
    expect(deps.run).toHaveBeenCalledWith('npx', ['prisma', 'migrate', 'dev', '--name', 'ekle'], env);
  });

  it('bilinmeyen / boş / prototip adlı işlem → onay değişkeni aynı ad olsa bile ret', () => {
    for (const operation of [undefined, '', 'reset', 'constructor', '__proto__', 'toString']) {
      const deps = fakeDeps();
      const argv = operation === undefined ? [] : [operation];
      const code = runDangerousDbCommand(argv, { [DANGEROUS_DB_APPROVAL_ENV]: operation ?? '' }, deps);
      expect(code, String(operation)).toBe(DB_GUARD_REFUSED_EXIT_CODE);
      expect(deps.run).not.toHaveBeenCalled();
    }
  });

  it('ret mesajı Türkçe gerekçe + canlı=lokal uyarısı + güvenli yol + onay yolunu içerir', () => {
    const seed = checkDangerousDbApproval('seed', {});
    const migrate = checkDangerousDbApproval('migrate-dev', {});
    if (seed.allowed || migrate.allowed) throw new Error('onaysız izin verildi');
    for (const message of [seed.message, migrate.message]) {
      expect(message).toContain('DB KİLİDİ');
      expect(message).toContain('CANLI = LOKAL AYNI DB');
      expect(message).toContain('Güvenli yol');
      expect(message).toContain(DANGEROUS_DB_APPROVAL_ENV);
    }
    expect(seed.message).toContain('deleteMany');
    expect(seed.message).toContain('seed:certification');
    expect(migrate.message).toContain('SIFIRLAMAYI');
    expect(migrate.message).toContain('Migration Kuralı');
    expect(migrate.message).toContain('IF NOT EXISTS');
    expect(migrate.message).toContain('prisma db execute');
    expect(migrate.message).toContain('prisma migrate resolve');
    expect(migrate.message).toContain('prisma:migrate:status');
  });
});

describe('AJ-96 · migrate-dev onayı yalnız yerel veritabanında geçer', () => {
  const approved = (DATABASE_URL: string | undefined): DbGuardEnv => ({
    [DANGEROUS_DB_APPROVAL_ENV]: 'migrate-dev',
    DATABASE_URL,
  });

  it('canlı biçimli (yönetilen/uzak) adres + doğru onay → ret, çalıştırıcı ÇAĞRILMAZ', () => {
    const remote = [
      'postgresql://u:p@ep-example-123.eu-west-2.aws.neon.tech/neondb?sslmode=require',
      'postgresql://u:p@ep-example-123-pooler.eu-west-2.aws.neon.tech/neondb',
      'postgresql://u:p@postgres:5432/menti', // docker-compose prod servis adı
      'postgresql://u:p@10.0.0.5:5432/menti',
      'postgresql://u:p@localhost.example.com:5432/menti',
    ];
    for (const url of remote) {
      const deps = fakeDeps();
      expect(runDangerousDbCommand(['migrate-dev'], approved(url), deps), url).toBe(DB_GUARD_REFUSED_EXIT_CODE);
      expect(deps.run, url).not.toHaveBeenCalled();
      expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('yerel değil'));
    }
  });

  it('hedef doğrulanamıyorsa (adres yok / bozuk / ?host= ile ezilmiş) + doğru onay → ret', () => {
    for (const url of [undefined, '', '   ', 'bozuk adres', 'postgresql://u:p@localhost:5432/db?host=ep-x.neon.tech']) {
      const deps = fakeDeps();
      expect(runDangerousDbCommand(['migrate-dev'], approved(url), deps), String(url)).toBe(
        DB_GUARD_REFUSED_EXIT_CODE,
      );
      expect(deps.run, String(url)).not.toHaveBeenCalled();
    }
  });

  it('yerel adres + doğru onay → izin (localhost / 127.0.0.1 / ::1)', () => {
    for (const url of [LOCAL_DB_URL, 'postgresql://u:p@127.0.0.1:5432/db', 'postgresql://u:p@[::1]:5432/db']) {
      const decision = checkDangerousDbApproval('migrate-dev', approved(url));
      expect(decision.allowed, url).toBe(true);
    }
  });

  it('ret mesajı onaya rağmen neden durulduğunu ve yerel host şartını söyler', () => {
    const decision = checkDangerousDbApproval('migrate-dev', approved('postgresql://u:p@db.example.com/x'));
    if (decision.allowed) throw new Error('canlı biçimli adreste izin verildi');
    expect(decision.message).toContain('DB KİLİDİ');
    expect(decision.message).toContain('onay verildi');
    expect(decision.message).toContain('"db.example.com" yerel değil');
    expect(decision.message).toContain('CANLI = LOKAL AYNI DB');
    expect(decision.message).toContain('Güvenli yol');
  });

  it('onaysız ret mesajı da onayın yalnız yerel host\'ta geçtiğini söyler', () => {
    const decision = checkDangerousDbApproval('migrate-dev', {});
    if (decision.allowed) throw new Error('onaysız izin verildi');
    expect(decision.message).toContain('yalnız yerel host');
  });

  it('seed onay yolu değişmedi (host şartı seed.ts içindeki KR-01 kilidinde)', () => {
    expect(checkDangerousDbApproval('seed', { [DANGEROUS_DB_APPROVAL_ENV]: 'seed' }).allowed).toBe(true);
  });

  it('CLI backend/.env\'i var olan ortam değişkenini ezmeden yükler (Prisma ile aynı hedef)', () => {
    const cli = readFileSync(path.join(BACKEND_ROOT, 'scripts', 'db-guard.ts'), 'utf8');
    expect(cli).toMatch(/dotenvConfig\(\{ path: resolve\(.*'\.\.\/\.env'\)/);
    expect(cli).not.toMatch(/override:\s*true/);
    expect(cli.indexOf('dotenvConfig(')).toBeLessThan(cli.indexOf('runDangerousDbCommand(process.argv'));
  });
});

describe('AJ-57 · package.json tehlikeli komutları koruma betiğinden geçirir', () => {
  const pkg = JSON.parse(readFileSync(path.join(BACKEND_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    prisma?: { seed?: string };
  };

  /** Korumasız çalıştırılırsa veri silen / DB sıfırlayan komut parçaları. */
  const UNGUARDED_DANGER =
    /migrate\s+(dev|reset)|db\s+push\b.*--(accept-data-loss|force-reset)|prisma\/seed\.ts|db\s+seed/;

  it('"seed" betiği koruma betiğinden geçer (doğrudan prisma/seed.ts DEĞİL)', () => {
    expect(pkg.scripts['seed']).toBe('tsx scripts/db-guard.ts seed');
  });

  it('"prisma:migrate" betiği koruma betiğinden geçer (doğrudan migrate dev DEĞİL)', () => {
    expect(pkg.scripts['prisma:migrate']).toBe('tsx scripts/db-guard.ts migrate-dev');
  });

  it('prisma.seed (migrate reset / db seed tetikler) koruma betiğinden geçer', () => {
    expect(pkg.prisma?.seed).toBe('npx tsx scripts/db-guard.ts seed');
  });

  it('güvenli salt-okuma alternatifi tanımlı: prisma:migrate:status', () => {
    expect(pkg.scripts['prisma:migrate:status']).toBe('prisma migrate status');
  });

  it('hiçbir npm betiği ve prisma.seed korumasız migrate dev/reset, db push --accept-data-loss, db seed, prisma/seed.ts içermez', () => {
    const commands: Record<string, string> = { ...pkg.scripts, 'prisma.seed': pkg.prisma?.seed ?? '' };
    const offending = Object.entries(commands).filter(([, command]) => UNGUARDED_DANGER.test(command));
    expect(offending).toEqual([]);
  });
});

describe('AJ-57 · prisma/seed.ts onay kapısı', () => {
  const gatePath = path.join(BACKEND_ROOT, 'prisma', 'seed-approval-gate.ts');

  it('seed.ts İLK import olarak onay kapısını yükler (PrismaClient oluşturan modüllerden önce)', () => {
    const seedSource = readFileSync(path.join(BACKEND_ROOT, 'prisma', 'seed.ts'), 'utf8');
    const firstImport = seedSource.split(/\r?\n/).find((line) => /^import\s/.test(line));
    expect(firstImport).toBe("import './seed-approval-gate.js';");
  });

  it('kapı modülü yalnız saf koruma modülünü import eder (DB istemcisi yok)', () => {
    const gateSource = readFileSync(gatePath, 'utf8');
    const imports = gateSource.split(/\r?\n/).filter((line) => /^import\s/.test(line));
    expect(imports).toEqual([
      "import { checkDangerousDbApproval, DB_GUARD_REFUSED_EXIT_CODE } from '../src/dangerousDbGuard.js';",
    ]);
    expect(gateSource).not.toMatch(/new\s+PrismaClient|from\s+'@prisma\/client'/);
  });

  /** Kapı modülünü ayrı süreçte koşar; seed.ts KOŞULMAZ. DATABASE_URL bilerek kaldırılır. */
  function runGate(approval: string | undefined) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.DATABASE_URL;
    delete env[DANGEROUS_DB_APPROVAL_ENV];
    if (approval !== undefined) env[DANGEROUS_DB_APPROVAL_ENV] = approval;
    return spawnSync(process.execPath, ['--import', 'tsx', gatePath], {
      cwd: BACKEND_ROOT,
      env,
      encoding: 'utf8',
    });
  }

  it('onay yok → kapı sıfır olmayan kodla çıkar ve DB KİLİDİ mesajı basar', () => {
    const result = runGate(undefined);
    expect(result.status).toBe(DB_GUARD_REFUSED_EXIT_CODE);
    expect(result.stderr).toContain('DB KİLİDİ');
  });

  it('yanlış onay → kapı sıfır olmayan kodla çıkar', () => {
    expect(runGate('migrate-dev').status).toBe(DB_GUARD_REFUSED_EXIT_CODE);
  });

  it('doğru onay (seed) → kapı geçer (çıkış 0)', () => {
    const result = runGate('seed');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
