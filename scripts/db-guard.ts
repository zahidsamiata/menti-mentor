/**
 * AJ-57 — tehlikeli veritabanı komutlarının tek giriş kapısı (CLI).
 * Saf mantık: src/dangerousDbGuard.ts. Bu dosya yalnız süreç çalıştırma + çıkış kodu.
 *
 * KULLANIM (backend dizininde; npm betikleri ve package.json `prisma.seed` buradan geçer):
 *   npx tsx scripts/db-guard.ts seed              # onaysız → ret, hiçbir şey çalışmaz
 *   npx tsx scripts/db-guard.ts migrate-dev       # onaysız → ret, hiçbir şey çalışmaz
 *   MENTI_TEHLIKELI_DB_ONAY=migrate-dev npx tsx scripts/db-guard.ts migrate-dev --name x
 *     → yalnız izole/geçici DB'de, host doğrulanarak (CANLI = LOKAL AYNI DB).
 */
import { spawnSync } from 'node:child_process';
import { runDangerousDbCommand, DB_GUARD_REFUSED_EXIT_CODE } from '../src/dangerousDbGuard.js';

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
