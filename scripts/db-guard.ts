/**
 * AJ-57 — tehlikeli veritabanı komutlarının tek giriş kapısı (CLI).
 * Saf mantık: src/dangerousDbGuard.ts. Bu dosya yalnız süreç çalıştırma + çıkış kodu.
 *
 * KULLANIM (backend dizininde; npm betikleri ve package.json `prisma.seed` buradan geçer):
 *   npx tsx scripts/db-guard.ts seed              # onaysız → ret, hiçbir şey çalışmaz
 *   npx tsx scripts/db-guard.ts migrate-dev       # onaysız → ret, hiçbir şey çalışmaz
 *   MENTI_TEHLIKELI_DB_ONAY=migrate-dev npx tsx scripts/db-guard.ts migrate-dev --name x
 *     → yalnız DATABASE_URL yerel host'u gösteriyorsa (AJ-96; CANLI = LOKAL AYNI DB).
 *
 * backend/.env burada yüklenir (var olan ortam değişkenini EZMEDEN) — Prisma da aynı dosyayı aynı
 * öncelikle okur; kapı, komutun gerçekten bağlanacağı DATABASE_URL'i denetlemiş olur.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { runDangerousDbCommand, DB_GUARD_REFUSED_EXIT_CODE } from '../src/dangerousDbGuard.js';

dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env'), quiet: true });

const exitCode = runDangerousDbCommand(process.argv.slice(2), process.env, {
  run: (command, args, env) => {
    const result = spawnSync(command, [...args], {
      stdio: 'inherit',
      env,
      // Windows'ta npx bir .cmd dosyasıdır; kabuk olmadan bulunamaz.
      shell: process.platform === 'win32',
    });
    if (result.error) {
      console.error(`DB KİLİDİ: komut başlatılamadı (${command}).`);
      return DB_GUARD_REFUSED_EXIT_CODE;
    }
    return result.status ?? DB_GUARD_REFUSED_EXIT_CODE;
  },
  logError: (message) => console.error(message),
});

process.exit(exitCode);
